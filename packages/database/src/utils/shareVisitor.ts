import { type AnyColumn, isNull, sql } from 'drizzle-orm';

import { files, messages, messagesFiles, topics } from '../schemas';

/**
 * Agent-share visitor topics carry the creator's `userId` (billing/data
 * attribution) plus a non-null `senderId` (the visitor), so plain ownership
 * predicates surface them inside the creator's own workspace. Every
 * creator-facing listing/aggregation over `topics` must AND this in —
 * lists, unread badges, stats, memory extraction, digests. Share-scoped
 * access goes through the dedicated `*BySender` methods instead; visitor
 * usage is reported separately by the Cloud share usage center.
 */
export const notShareVisitorTopic = () => isNull(topics.senderId);

/**
 * Twin of {@link notShareVisitorTopic} for `messages`-table aggregates.
 * Messages carry no `senderId` — visitor authorship is only identifiable
 * through the parent topic, so this correlates a NOT EXISTS against `topics`
 * to keep callers join-free. Messages without a topic are trivially kept.
 */
export const notShareVisitorMessage = () => notShareVisitorTopicRef(messages.topicId);

/**
 * Generic form of {@link notShareVisitorMessage} for any table that references
 * a topic by id (messages, agent operations, …). Correlates a NOT EXISTS
 * against `topics` so the caller needs no join; rows with a NULL topic
 * reference are trivially kept.
 */
export function notShareVisitorTopicRef(topicIdColumn: AnyColumn) {
  // Drizzle's relational query builder (`db.query.<table>.findFirst/findMany`)
  // aliases the queried table to a fixed name and then rewrites references
  // inside `sql`` templates to that alias — so `${topics.id}` was rendering as
  // `"messages"."id"` inside `.findFirst({ where: ... })`, which crashed the
  // moment `ownership()` started ANDing this predicate by default. Hard-code
  // the correlated table alias with `sql.raw` so the inner reference is
  // immune to the outer alias rewriting.
  return sql`NOT EXISTS (SELECT 1 FROM ${topics} WHERE ${sql.raw('"topics"."id"')} = ${topicIdColumn} AND ${sql.raw('"topics"."sender_id"')} IS NOT NULL)`;
}

/**
 * Accept a `files` row joined from `messages_files` when it was attached by
 * the agent-share VISITOR of the message's topic.
 *
 * Share visitor turns persist under the CREATOR's `userId` (only
 * `topics.senderId` marks the visitor), but the files a visitor attaches are
 * uploaded through the visitor's own account, so `files.user_id` is the
 * visitor. Creator-scoped file guards (`files.user_id = creator`) would
 * therefore tombstone every visitor attachment — no name, no url, and no
 * parsed content for the next model turn. This predicate OR-ed onto that
 * guard lets a file through exactly when the topic's `sender_id` is the file
 * owner: the visitor sees and re-feeds their own uploads, and a creator-owned
 * file still resolves through the base guard. Only for visitor-inclusive
 * scopes; creator-facing reads never reach visitor topics in the first place.
 *
 * Correlated on `messages_files.message_id` / `files.user_id` of the outer
 * join, with the inner references hard-coded via `sql.raw` for the same
 * alias-rewriting reason as {@link notShareVisitorTopicRef}.
 */
export const shareVisitorOwnedFile = () =>
  sql`EXISTS (SELECT 1 FROM ${messages} INNER JOIN ${topics} ON ${sql.raw('"topics"."id"')} = ${sql.raw('"messages"."topic_id"')} WHERE ${sql.raw('"messages"."id"')} = ${messagesFiles.messageId} AND ${sql.raw('"topics"."sender_id"')} = ${files.userId})`;
