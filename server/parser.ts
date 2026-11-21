import type { ParsedReportResult, RoleName } from './types.ts';

export interface ProjectCatalogEntry {
  id: string;
  title: string;
  aliases: string[];
}

export interface ChannelMappingEntry {
  projectId: string;
  isDefault: boolean;
}

export interface RoleAliasEntry {
  alias: string;
  role: RoleName;
}

const VALID_WORK_STATUSES = new Set([
  'done',
  'completed',
  'complete',
  'finish',
  'finished',
  'selesai',
]);

const MAX_EXPANDED_CHAPTERS = 200;

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract mentions from Discord message syntax (<@123>, <@!123>, @Controller, @everyone, @here)
 * and return both extracted mention tokens and the text with mentions stripped.
 * CRITICAL: Mentioned users (@Controller) are NEVER treated as the worker.
 */
export function extractAndStripMentions(
  rawContent: string,
  explicitMentions: string[] = []
): { mentions: string[]; stripped: string } {
  const found = new Set<string>(explicitMentions);
  const mentionRegex = /<@!?\d+>|@[A-Za-z0-9_.-]+/g;
  const matches = rawContent.match(mentionRegex);
  if (matches) {
    for (const m of matches) {
      found.add(m);
    }
  }
  const stripped = rawContent.replace(mentionRegex, ' ').replace(/\s+/g, ' ').trim();
  return {
    mentions: Array.from(found),
    stripped,
  };
}

/**
 * Extract leading hashtags / channel references like #Solo-Leveling or #file-ts.
 */
function extractLeadingChannelTags(text: string): {
  tags: string[];
  body: string;
} {
  const tags: string[] = [];
  let remaining = text.trim();
  const tagRegex = /^#([A-Za-z0-9_-]+)\s*/;
  while (true) {
    const match = remaining.match(tagRegex);
    if (!match) break;
    tags.push(match[1]);
    remaining = remaining.slice(match[0].length).trim();
  }
  return { tags, body: remaining };
}

/**
 * Deterministic chapter extractor and inclusive range expander.
 * Supports:
 * - CH 18, ch 18, Ch 18, Chapter 18, chapter 18, CH108
 * - CH 108-110, CH 108 - 110, Chapter 108 sampai 110
 * - CH 108, 109, 110, CH 108 & 109
 * - CH 108-110, 115, 118-120
 */
export function parseChapterSegment(text: string): {
  foundChapterKeyword: boolean;
  chapters: number[];
  invalidReason: string | null;
  chapterMatchStart: number;
  chapterMatchEnd: number;
} {
  // Match keyword (chapter / ch) followed by numbers, ranges, commas, &, sampai/to/sd
  const chapterClauseRegex =
    /\b(?:chapter|chap|ch)\s*\.?\s*([+-]?\d+(?:\s*(?:-|–|—|sampai|to|s\/d|sd|,|&|\bdan\b)\s*[+-]?\d+)*)/i;
  const match = text.match(chapterClauseRegex);

  if (!match || match.index === undefined) {
    // Check if keyword exists with invalid non-numeric value like "CH abc"
    const brokenMatch = text.match(/\b(?:chapter|chap|ch)\s*\.?\s*([a-zA-Z-]+)/i);
    if (brokenMatch && brokenMatch.index !== undefined) {
      return {
        foundChapterKeyword: true,
        chapters: [],
        invalidReason: `Chapter tidak valid dekat "${brokenMatch[0]}"`,
        chapterMatchStart: brokenMatch.index,
        chapterMatchEnd: brokenMatch.index + brokenMatch[0].length,
      };
    }
    return {
      foundChapterKeyword: false,
      chapters: [],
      invalidReason: null,
      chapterMatchStart: -1,
      chapterMatchEnd: -1,
    };
  }

  const rawExpr = match[1];
  const normalizedExpr = rawExpr
    .replace(/\b(?:sampai|to|s\/d|sd)\b/gi, '-')
    .replace(/\b(?:dan)\b/gi, ',')
    .replace(/[–—]/g, '-')
    .replace(/&/g, ',');

  const parts = normalizedExpr
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  const chapterSet = new Set<number>();
  const orderedChapters: number[] = [];

  for (const part of parts) {
    // Check if it's a range (note: watch out for negative numbers like -5)
    const rangeMatch = part.match(/^([+-]?\d+)\s*-\s*([+-]?\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end <= 0) {
        return {
          foundChapterKeyword: true,
          chapters: [],
          invalidReason: `Nomor chapter harus bilangan bulat positif (${part})`,
          chapterMatchStart: match.index,
          chapterMatchEnd: match.index + match[0].length,
        };
      }
      if (end < start) {
        return {
          foundChapterKeyword: true,
          chapters: [],
          invalidReason: `Rentang chapter terbalik (${start}-${end})`,
          chapterMatchStart: match.index,
          chapterMatchEnd: match.index + match[0].length,
        };
      }
      const count = end - start + 1;
      if (count > MAX_EXPANDED_CHAPTERS) {
        return {
          foundChapterKeyword: true,
          chapters: [],
          invalidReason: `Rentang chapter terlalu besar (${count} chapter, batas ${MAX_EXPANDED_CHAPTERS})`,
          chapterMatchStart: match.index,
          chapterMatchEnd: match.index + match[0].length,
        };
      }
      for (let c = start; c <= end; c++) {
        if (!chapterSet.has(c)) {
          chapterSet.add(c);
          orderedChapters.push(c);
        }
      }
    } else if (/^[+-]?\d+$/.test(part)) {
      const num = Number(part);
      if (!Number.isInteger(num) || num <= 0 || num > 99999) {
        return {
          foundChapterKeyword: true,
          chapters: [],
          invalidReason: `Nomor chapter di luar batas valid (${part})`,
          chapterMatchStart: match.index,
          chapterMatchEnd: match.index + match[0].length,
        };
      }
      if (!chapterSet.has(num)) {
        chapterSet.add(num);
        orderedChapters.push(num);
      }
    } else {
      return {
        foundChapterKeyword: true,
        chapters: [],
        invalidReason: `Format segment chapter tidak dikenali (${part})`,
        chapterMatchStart: match.index,
        chapterMatchEnd: match.index + match[0].length,
      };
    }
  }

  return {
    foundChapterKeyword: true,
    chapters: orderedChapters,
    invalidReason: orderedChapters.length === 0 ? 'Daftar chapter kosong' : null,
    chapterMatchStart: match.index,
    chapterMatchEnd: match.index + match[0].length,
  };
}

function matchRole(
  text: string,
  roleAliases: RoleAliasEntry[]
): { role: RoleName | null; matchedToken: string | null } {
  // Sort aliases longest first so multi-word or longer aliases match cleanly
  const sorted = [...roleAliases].sort((a, b) => b.alias.length - a.alias.length);
  for (const entry of sorted) {
    const escaped = entry.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    const m = text.match(regex);
    if (m) {
      return { role: entry.role, matchedToken: m[0] };
    }
  }
  return { role: null, matchedToken: null };
}

function matchWorkStatus(text: string): string | null {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (const t of tokens) {
    if (VALID_WORK_STATUSES.has(t)) {
      return t;
    }
  }
  return null;
}

function findProjectMatch(
  candidateText: string,
  tags: string[],
  projects: ProjectCatalogEntry[]
): { project: ProjectCatalogEntry | null; matchedVia: string | null; rawCandidate: string } {
  const normalizedBody = normalizeText(candidateText);

  // Build searchable patterns sorted by length descending to prefer exact longer titles
  const candidates: Array<{ pattern: string; project: ProjectCatalogEntry }> = [];
  for (const p of projects) {
    candidates.push({ pattern: normalizeText(p.title), project: p });
    for (const a of p.aliases) {
      const normA = normalizeText(a);
      if (normA) candidates.push({ pattern: normA, project: p });
    }
  }
  candidates.sort((a, b) => b.pattern.length - a.pattern.length);

  // 1. Try matching explicit title/alias in the body text before chapter
  if (normalizedBody) {
    for (const item of candidates) {
      if (
        normalizedBody === item.pattern ||
        normalizedBody.includes(item.pattern)
      ) {
        return {
          project: item.project,
          matchedVia: 'message_text',
          rawCandidate: candidateText.trim(),
        };
      }
    }
  }

  // 2. Try matching leading #tag (like #Solo-Leveling) against project title/aliases
  for (const tag of tags) {
    const normTag = normalizeText(tag);
    for (const item of candidates) {
      if (normTag === item.pattern) {
        return {
          project: item.project,
          matchedVia: 'leading_tag',
          rawCandidate: `#${tag}`,
        };
      }
    }
  }

  return {
    project: null,
    matchedVia: null,
    rawCandidate: candidateText.trim(),
  };
}

export function parseDiscordReport(
  rawContent: string,
  options: {
    projects: ProjectCatalogEntry[];
    channelMappings: ChannelMappingEntry[];
    roleAliases: RoleAliasEntry[];
    explicitMentions?: string[];
  }
): ParsedReportResult {
  const notes: string[] = [];
  const { mentions, stripped } = extractAndStripMentions(
    rawContent,
    options.explicitMentions
  );
  const { tags, body } = extractLeadingChannelTags(stripped);

  const chapterInfo = parseChapterSegment(body);
  const afterChapterText =
    chapterInfo.chapterMatchEnd >= 0
      ? body.slice(chapterInfo.chapterMatchEnd)
      : body;
  const beforeChapterText =
    chapterInfo.chapterMatchStart >= 0
      ? body.slice(0, chapterInfo.chapterMatchStart)
      : '';

  const roleMatch = matchRole(afterChapterText || body, options.roleAliases);
  const workStatus = matchWorkStatus(afterChapterText || body);

  // Determine if message is general chat (not a work report at all)
  if (!chapterInfo.foundChapterKeyword && !roleMatch.role) {
    return {
      isReport: false,
      parseStatus: 'NOT_A_REPORT',
      parseNotes: ['Pesan tidak mengandung kata kunci chapter atau role pekerjaan.'],
      projectId: null,
      projectTitleMatched: null,
      role: null,
      roleTokenMatched: null,
      workStatus,
      chapters: [],
      mentions,
      cleanedContent: stripped,
    };
  }

  // If chapter keyword exists but invalid range/numbers
  if (chapterInfo.foundChapterKeyword && chapterInfo.invalidReason) {
    notes.push(chapterInfo.invalidReason);
  }
  if (!chapterInfo.foundChapterKeyword) {
    notes.push('Nomor chapter tidak ditemukan.');
  }

  // Check role
  if (!roleMatch.role) {
    notes.push('Role pekerjaan (ETL/Translator, TS/Editor, atau Solo) tidak dikenali.');
  }

  // Check work status
  if (!workStatus) {
    notes.push('Status penyelesaian (Done/Completed/Finish/Finished) tidak ditemukan.');
  }

  // Identify project from message text / tags and compare with channel mapping
  const textMatch = findProjectMatch(beforeChapterText, tags, options.projects);
  const mappedProjectIds = options.channelMappings.map((m) => m.projectId);
  const defaultMapping =
    options.channelMappings.find((m) => m.isDefault) ??
    (options.channelMappings.length === 1 ? options.channelMappings[0] : null);

  let resolvedProjectId: string | null = null;
  let projectTitleMatched: string | null = textMatch.project?.title ?? null;
  let hasConflict = false;
  let isAmbiguousProject = false;

  if (textMatch.project) {
    resolvedProjectId = textMatch.project.id;
    // Conflict check: if channel is mapped strictly to project(s) and none match textMatch.project
    if (
      mappedProjectIds.length > 0 &&
      !mappedProjectIds.includes(textMatch.project.id)
    ) {
      hasConflict = true;
      notes.push(
        `Konflik komik: pesan menyebut "${textMatch.project.title}", sedangkan channel ini ter-mapping ke proyek lain.`
      );
    }
  } else if (beforeChapterText.trim().length > 0) {
    // Message typed an unknown comic name before CH!
    if (defaultMapping && mappedProjectIds.length === 1) {
      // Unknown title in message vs mapped channel -> flag for admin review
      resolvedProjectId = defaultMapping.projectId;
      hasConflict = true;
      notes.push(
        `Nama komik "${beforeChapterText.trim()}" tidak dikenal pada daftar komik, perlu pemeriksaan admin.`
      );
    } else {
      isAmbiguousProject = true;
      notes.push(`Komik "${beforeChapterText.trim()}" tidak ditemukan di database.`);
    }
  } else {
    // Comic name not written in message -> use channel mapping
    if (defaultMapping) {
      resolvedProjectId = defaultMapping.projectId;
      const matchedProj = options.projects.find((p) => p.id === defaultMapping.projectId);
      projectTitleMatched = matchedProj?.title ?? null;
    } else if (mappedProjectIds.length > 1) {
      isAmbiguousProject = true;
      notes.push('Channel ini terhubung ke lebih dari 1 komik dan nama komik tidak ditulis di pesan.');
    } else {
      isAmbiguousProject = true;
      notes.push('Channel belum di-mapping ke komik dan nama komik tidak ditulis.');
    }
  }

  // Determine overall parseStatus
  let parseStatus: ParsedReportResult['parseStatus'] = 'VALID';
  if (chapterInfo.invalidReason || chapterInfo.chapters.length === 0) {
    parseStatus = 'INVALID_CHAPTER';
  } else if (!roleMatch.role) {
    parseStatus = 'UNKNOWN_ROLE';
  } else if (hasConflict) {
    parseStatus = 'PROJECT_CHANNEL_CONFLICT';
  } else if (isAmbiguousProject || !resolvedProjectId) {
    parseStatus = 'AMBIGUOUS_PROJECT';
  } else if (!workStatus) {
    parseStatus = 'UNKNOWN_STATUS';
  }

  return {
    isReport: true,
    parseStatus,
    parseNotes: notes,
    projectId: resolvedProjectId,
    projectTitleMatched,
    role: roleMatch.role,
    roleTokenMatched: roleMatch.matchedToken,
    workStatus,
    chapters: chapterInfo.chapters,
    mentions,
    cleanedContent: stripped,
  };
}
