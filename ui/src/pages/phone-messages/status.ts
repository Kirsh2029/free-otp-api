import type { Message, PhoneMessagesResponse } from '../../types';

export function extractMessages(response?: PhoneMessagesResponse): Message[] {
  if (response?.results?.length) return response.results;
  return response?.result ? [response.result] : [];
}

/** A successful history read is separate from a controlled fresh-delivery test. */
export function inboxStatus(response: PhoneMessagesResponse) {
  const messages = extractMessages(response);
  const diagnostics = response.diagnostics;
  if (messages.length) return {
    kind: 'matched' as const,
    title: `${messages.length} matching message${messages.length === 1 ? '' : 's'} returned`,
    description: 'These are messages visible in the public inbox. Their presence does not verify that this number will receive a new SMS.'
  };
  if (diagnostics && diagnostics.observedMessageCount > 0) return {
    kind: 'filtered' as const,
    title: 'Inbox readable; no messages match these filters',
    description: `${diagnostics.observedMessageCount} messages were observed on this page. ${diagnostics.timeFilteredCount} fall outside the time window and ${diagnostics.matcherFilteredCount} do not match the text filter. No matching new message has been observed.`
  };
  if (diagnostics?.emptyInbox) return {
    kind: 'empty' as const,
    title: 'Inbox readable; the provider displays no messages',
    description: 'The current inbox page is empty. This does not establish that a new SMS can be delivered to this number.'
  };
  return {
    kind: 'unknown' as const,
    title: 'No messages returned for these filters',
    description: 'The response does not establish fresh SMS delivery. View the inbox history or adjust the time and text filters to investigate.'
  };
}

export function newestMessageTimestamp(response?: PhoneMessagesResponse): number | undefined {
  if (response?.diagnostics?.newestMessageAt !== undefined) return response.diagnostics.newestMessageAt;
  const timestamps = extractMessages(response).map((message) => message.ago).filter((value) => Number.isFinite(value) && value > 0);
  return timestamps.length ? Math.max(...timestamps) : undefined;
}
