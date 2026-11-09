/**
 * Outline for LOG documents.
 *
 * The Outline panel groups events the way an operator scans a log: by the
 * minute when the file carries timestamps, otherwise by level. Each leaf points
 * at the 1-based line of its event so the panel can jump there.
 */

import { t } from "@/shared/i18n";
import type { OutlineItem } from "@/shared/types";

import { parseLog, type LogEvent, type LogLevel } from "./parse";

const ISO_GROUP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/;
const CLOCK_GROUP = /^(\d{2}):(\d{2})/;

/** Outline groups and events for a LOG document; empty for an empty file. */
export function logOutline(source: string): OutlineItem[] {
  const model = parseLog(source).model;
  if (!model) return [];

  const groups = new Map<string, { text: string; line: number; children: OutlineItem[] }>();

  for (const event of model.events) {
    const key = groupKey(event);
    let group = groups.get(key.id);
    if (!group) {
      group = { text: key.text, line: event.line, children: [] };
      groups.set(key.id, group);
    }
    group.children.push({
      id: `log-outline-event-${event.line}`,
      text: eventText(event),
      level: 2,
      line: event.line,
      children: [],
    });
  }

  return [...groups.values()].map((group, index) => ({
    id: `log-outline-group-${index}`,
    text: group.text,
    level: 1,
    line: group.line,
    children: group.children,
  }));
}

function groupKey(event: LogEvent): { id: string; text: string } {
  const time = event.time?.trim() ?? "";
  if (time) {
    const iso = ISO_GROUP.exec(time);
    if (iso) {
      const label = `${iso[1]} ${iso[2]}:${iso[3]}`;
      return { id: label, text: label };
    }
    const clock = CLOCK_GROUP.exec(time);
    if (clock) {
      const label = `${clock[1]}:${clock[2]}`;
      return { id: label, text: label };
    }
    return { id: time, text: time };
  }

  return { id: `level:${event.level}`, text: levelLabel(event.level, event.levelText) };
}

function levelLabel(level: LogLevel, levelText: string): string {
  return level === "unknown" ? t("viewer.log.unknown") : levelText;
}

function eventText(event: LogEvent): string {
  const message = event.message.trim();
  return message.length > 0 ? message : t("viewer.log.line", { line: event.line });
}
