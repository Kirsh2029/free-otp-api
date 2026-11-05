import { Cluster } from 'puppeteer-cluster';
import puppeteer, { type Page } from 'puppeteer';
import { consola } from 'consola';
import { config } from '../config.js';

type BrowserTask<D, R> = (context: { page: Page; data: D }) => Promise<R>;
const cancellation = (message: string, statusCode = 503): Error & { statusCode: number } =>
  Object.assign(new Error(message), { statusCode });

export class BrowserPool {
  cluster?: Cluster;
  private creating?: Promise<Cluster>;
  private rotating?: Promise<void>;
  private readonly active = new Set<Promise<unknown>>();
  private readonly controllers = new Set<AbortController>();
  private readonly registeredPages = new WeakSet<Page>();
  private shuttingDown = false;

  async createCluster(): Promise<void> {
    if (this.shuttingDown) throw cancellation('Browser is shutting down');
    if (this.cluster) return;
    if (!this.creating) {
      const args = ['--disable-dev-shm-usage'];
      if (config.browser.noSandbox) args.push('--no-sandbox', '--disable-setuid-sandbox');
      if (config.browser.proxy) args.push('--proxy-server=' + config.browser.proxy);
      this.creating = Cluster.launch({
        puppeteer,
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: config.browser.maxConcurrency,
        timeout: config.browser.taskTimeoutMs,
        retryLimit: 0,
        sameDomainDelay: 1000,
        puppeteerOptions: {
          headless: true,
          executablePath: config.browser.executablePath,
          handleSIGINT: false,
          handleSIGHUP: false,
          handleSIGTERM: false,
          args
        }
      });
    }
    try { this.cluster = await this.creating; }
    finally { this.creating = undefined; }
  }

  async execute<D, R>(data: D, task: BrowserTask<D, R>, options: { signal?: AbortSignal } = {}): Promise<R> {
    if (this.rotating) await this.rotating;
    if (this.shuttingDown) throw cancellation('Browser is shutting down');
    const controller = new AbortController();
    this.controllers.add(controller);
    const externalAbort = (): void => { controller.abort(options.signal?.reason ?? cancellation('Browser request was cancelled')); };
    if (options.signal?.aborted) externalAbort();
    else options.signal?.addEventListener('abort', externalAbort, { once: true });
    const timer = setTimeout(() => controller.abort(cancellation('Browser operation exceeded its deadline', 504)), config.browser.taskTimeoutMs);
    let rejectOnAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectOnAbort = () => reject(controller.signal.reason);
      if (controller.signal.aborted) rejectOnAbort();
      else controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
    });
    const run = (async () => {
      controller.signal.throwIfAborted();
      await this.createCluster();
      controller.signal.throwIfAborted();
      const cluster = this.cluster;
      if (!cluster) throw cancellation('Browser startup failed');
      return cluster.execute(data, async ({ page, data: payload }) => {
        controller.signal.throwIfAborted();
        this.registerPageHandlers(page);
        const closePage = (): void => { page.close().catch(() => undefined); };
        controller.signal.addEventListener('abort', closePage, { once: true });
        try { return await task({ page, data: payload as D }); }
        finally { controller.signal.removeEventListener('abort', closePage); }
      }) as Promise<R>;
    })();
    // Queue waiting, browser startup, and navigation share a single finite deadline.
    const operation = Promise.race([run, aborted]);
    this.active.add(operation);
    try { return await operation; }
    finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', externalAbort);
      if (rejectOnAbort) controller.signal.removeEventListener('abort', rejectOnAbort);
      this.active.delete(operation);
      this.controllers.delete(controller);
    }
  }

  abortTasks(): void {
    for (const controller of this.controllers) controller.abort(cancellation('Browser work cancelled during shutdown'));
  }

  async refreshCluster(): Promise<void> {
    if (this.rotating) return this.rotating;
    this.rotating = (async () => {
      await Promise.allSettled([...this.active]);
      if (this.creating) await this.creating.catch(() => undefined);
      const cluster = this.cluster;
      this.cluster = undefined;
      if (cluster) await cluster.close();
    })();
    try { await this.rotating; }
    finally { this.rotating = undefined; }
  }

  async closeCluster(): Promise<void> {
    this.shuttingDown = true;
    this.abortTasks();
    await this.refreshCluster();
  }

  registerPageHandlers(page: Page): void {
    if (this.registeredPages.has(page)) return;
    this.registeredPages.add(page);
    page.setDefaultNavigationTimeout(config.browser.navigationTimeoutMs);
    page.setDefaultTimeout(config.browser.navigationTimeoutMs);
    page.on('error', () => consola.warn('Browser page crashed'));
  }
}

export const browser = new BrowserPool();
