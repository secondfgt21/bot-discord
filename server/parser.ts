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

export interface GuildChannelMappingEntry {
  discordChannelId: string;
  channelName: string;
  projectId: string | null;
  isDefault: boolean;
}

export interface MentionedChannelInfo {
  id: string;
  name: string;
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

// Generic/utility channels (like #file-tl) that must NEVER be treated as a comic title
export const NON_COMIC_CHANNEL_IDS = new Set<string>([
  '1352988212079104031', // #file-tl
]);

const NON_COMIC_CHANNEL_NAMES = new Set<string>([
  'file-tl',
  'file-ts',
  'file-etl',
  'file-editor',
  'file-raw',
  'file-clean',
  'file-cl',
  'file-pr',
  'file-qc',
  'file-solo',
  'laporan',
  'laporan-tl',
  'laporan-ts',
  'laporan-etl',
  'laporan-kerja',
  'laporan-chapter',
  'report',
  'reports',
  'general',
]);

const MAX_EXPANDED_CHAPTERS = 200;

/**
 * Strip invisible/zero-width/BOM characters (such as \uFEFF, \u200B, etc.)
 * and normalize non-breaking spaces to regular spaces.
 */
export function stripInvisibleChars(input: string): string {
  return input
    .replace(/[\uFEFF\u200B-\u200F\u202A-\u202E\u2060-\u206F\u00AD]/g, '')
    .replace(/\u00A0/g, ' ');
}

export function isNonComicChannel(
  channelId?: string | null,
  channelName?: string | null
): boolean {
  if (channelId && NON_COMIC_CHANNEL_IDS.has(channelId.trim())) {
    return true;
  }
  if (channelName) {
    const slug = stripInvisibleChars(channelName)
      .replace(/^#+/, '')
      .trim()
      .toLowerCase()
      .replace(/[_\s]+/g, '-');
    if (slug && NON_COMIC_CHANNEL_NAMES.has(slug)) {
      return true;
    }
  }
  return false;
}

/**
 * Normalize a Discord channel name or hashtag slug into a readable comic title.
 * Example: "#Solo-Leveling" -> "Solo Leveling", "#solo-leveling" -> "Solo Leveling".
 */
export function normalizeChannelNameToTitle(raw: string): string {
  const cleaned = stripInvisibleChars(raw)
    .replace(/^#+/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (cleaned === cleaned.toLowerCase()) {
    return cleaned
      .split(' ')
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(' ');
  }
  return cleaned;
}

/**
 * Sanitize explicit comic title text extracted from a message:
 * - Removes invisible/zero-width/BOM characters
 * - Strips any residual Discord channel mentions (<#...>) and user/role mentions (<@...>, @user)
 * - Strips trailing status clauses like ", ETL Done" if present
 * - Trims dangling separators at start/end while preserving internal punctuation (e.g. ":")
 */
export function sanitizeTitleText(raw: string): string {
  let text = stripInvisibleChars(raw)
    .replace(/<#\d+>/g, ' ')
    .replace(/<@[!&]?\d+>|@[A-Za-z0-9_.-]+/g, ' ')
    .replace(
      /(?:,\s*|\s+[-–—]\s+|\s+)(?:(?:etl|ts|tl|translator|editor|solo)\s+)?(?:done|completed|complete|finish|finished|selesai)\b.*$/i,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();

  text = text.replace(/^[\s\-–—,:;|/]+|[\s\-–—,:;|/]+$/g, '').trim();
  return text;
}

function normalizeText(input: string): string {
  return stripInvisibleChars(input)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesPattern(normalizedText: string, pattern: string): boolean {
  if (!normalizedText || !pattern) return false;
  if (normalizedText === pattern) return true;
  // Short aliases (<= 3 chars, e.g. "SL", "NM", "ORV") require exact match to avoid false positives
  if (pattern.length <= 3) return false;
  const boundaryRegex = new RegExp(
    `(?:^|[\\s,:;|/()\\[\\]])${escapeRegex(pattern)}(?:$|[\\s,:;|/()\\[\\]])`
  );
  return boundaryRegex.test(normalizedText);
}

/**
 * Extract user/role mentions from Discord message syntax (<@123>, <@!123>, <@&123>, @Controller)
 * and return both extracted mention tokens and the text with invisible chars & mentions stripped.
 * CRITICAL: Mentioned users (@Controller) are NEVER treated as the worker.
 */
export function extractAndStripMentions(
  rawContent: string,
  explicitMentions: string[] = []
): { mentions: string[]; stripped: string } {
  const cleanRaw = stripInvisibleChars(rawContent);
  const found = new Set<string>(explicitMentions);
  const mentionRegex = /<@[!&]?\d+>|@[A-Za-z0-9_.-]+/g;
  const matches = cleanRaw.match(mentionRegex);
  if (matches) {
    for (const m of matches) {
      found.add(m);
    }
  }
  const stripped = cleanRaw.replace(mentionRegex, ' ').replace(/\s+/g, ' ').trim();
  return {
    mentions: Array.from(found),
    stripped,
  };
}

/**
 * Extract Discord channel mentions (<#channel_id>) anywhere in the message
 * and leading hashtag channel references (#Solo-Leveling, #file-tl, etc.).
 */
export function extractChannelReferences(text: string): {
  mentionedChannelIds: string[];
  tags: string[];
  body: string;
} {
  const mentionedChannelIds: string[] = [];
  const channelMentionRegex = /<#(\d+)>/g;
  let match: RegExpExecArray | null;
  while ((match = channelMentionRegex.exec(text)) !== null) {
    if (!mentionedChannelIds.includes(match[1])) {
      mentionedChannelIds.push(match[1]);
    }
  }

  let remaining = text.replace(channelMentionRegex, ' ').replace(/\s+/g, ' ').trim();

  const tags: string[] = [];
  const tagRegex = /^#([A-Za-z0-9_-]+)\s*/;
  while (true) {
    const tagMatch = remaining.match(tagRegex);
    if (!tagMatch) break;
    tags.push(tagMatch[1]);
    remaining = remaining.slice(tagMatch[0].length).trim();
  }

  return {
    mentionedChannelIds,
    tags,
    body: remaining,
  };
}

function formatChapterDisplay(rawExpr: string | null, chapters: number[]): string {
  if (rawExpr && rawExpr.trim()) {
    return rawExpr
      .trim()
      .replace(/\b(?:sampai|to|s\/d|sd)\b/gi, '-')
      .replace(/\s*[-–—]\s*/g, '-')
      .replace(/\s*,\s*/g, ', ')
      .replace(/\s*&\s*/g, ', ')
      .replace(/\s+\bdan\b\s+/gi, ', ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (chapters.length === 0) return '-';
  if (chapters.length === 1) return String(chapters[0]);
  let isContiguous = true;
  for (let i = 1; i < chapters.length; i++) {
    if (chapters[i] !== chapters[i - 1] + 1) {
      isContiguous = false;
      break;
    }
  }
  if (isContiguous) {
    return `${chapters[0]}-${chapters[chapters.length - 1]}`;
  }
  return chapters.join(', ');
}

/**
 * Deterministic chapter extractor and inclusive range expander.
 * Supports:
 * - CH 08, CH 18, ch 18, Ch 18, Chapter 18, chapter 18, CH108
 * - CH 4-5, CH 108-110, CH 108 - 110, Chapter 108 sampai 110
 * - CH 108, 109, 110, CH 108 & 109
 * - CH 108-110, 115, 118-120
 */
export function parseChapterSegment(text: string): {
  foundChapterKeyword: boolean;
  chapters: number[];
  rawChapterExpr: string | null;
  chapterDisplay: string;
  invalidReason: string | null;
  chapterMatchStart: number;
  chapterMatchEnd: number;
} {
  const chapterClauseRegex =
    /\b(?:chapter|chap|ch)\s*\.?\s*([+-]?\d+(?:\s*(?:-|–|—|sampai|to|s\/d|sd|,|&|\bdan\b)\s*[+-]?\d+)*)/i;
  const match = text.match(chapterClauseRegex);

  if (!match || match.index === undefined) {
    const brokenMatch = text.match(/\b(?:chapter|chap|ch)\s*\.?\s*([a-zA-Z-]+)/i);
    if (brokenMatch && brokenMatch.index !== undefined) {
      return {
        foundChapterKeyword: true,
        chapters: [],
        rawChapterExpr: null,
        chapterDisplay: '-',
        invalidReason: `Chapter tidak valid dekat "${brokenMatch[0]}"`,
        chapterMatchStart: brokenMatch.index,
        chapterMatchEnd: brokenMatch.index + brokenMatch[0].length,
      };
    }
    return {
      foundChapterKeyword: false,
      chapters: [],
      rawChapterExpr: null,
      chapterDisplay: '-',
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
    const rangeMatch = part.match(/^([+-]?\d+)\s*-\s*([+-]?\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end <= 0) {
        return {
          foundChapterKeyword: true,
          chapters: [],
          rawChapterExpr: null,
          chapterDisplay: '-',
          invalidReason: `Nomor chapter harus bilangan bulat positif (${part})`,
          chapterMatchStart: match.index,
          chapterMatchEnd: match.index + match[0].length,
        };
      }
      if (end < start) {
        return {
          foundChapterKeyword: true,
          chapters: [],
          rawChapterExpr: null,
          chapterDisplay: '-',
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
          rawChapterExpr: null,
          chapterDisplay: '-',
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
          rawChapterExpr: null,
          chapterDisplay: '-',
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
        rawChapterExpr: null,
        chapterDisplay: '-',
        invalidReason: `Format segment chapter tidak dikenali (${part})`,
        chapterMatchStart: match.index,
        chapterMatchEnd: match.index + match[0].length,
      };
    }
  }

  return {
    foundChapterKeyword: true,
    chapters: orderedChapters,
    rawChapterExpr: rawExpr.trim(),
    chapterDisplay:
      orderedChapters.length > 0 ? formatChapterDisplay(rawExpr, orderedChapters) : '-',
    invalidReason: orderedChapters.length === 0 ? 'Daftar chapter kosong' : null,
    chapterMatchStart: match.index,
    chapterMatchEnd: match.index + match[0].length,
  };
}

function matchRole(
  text: string,
  roleAliases: RoleAliasEntry[]
): { role: RoleName | null; matchedToken: string | null } {
  const sorted = [...roleAliases].sort((a, b) => b.alias.length - a.alias.length);
  for (const entry of sorted) {
    const escaped = escapeRegex(entry.alias);
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

function matchProjectByText(
  candidateText: string,
  projects: ProjectCatalogEntry[]
): ProjectCatalogEntry | null {
  const normalizedBody = normalizeText(candidateText);
  if (!normalizedBody) return null;

  const candidates: Array<{ pattern: string; project: ProjectCatalogEntry }> = [];
  for (const p of projects) {
    candidates.push({ pattern: normalizeText(p.title), project: p });
    for (const a of p.aliases) {
      const normA = normalizeText(a);
      if (normA) candidates.push({ pattern: normA, project: p });
    }
  }
  candidates.sort((a, b) => b.pattern.length - a.pattern.length);

  // Pass 1: exact match first
  for (const item of candidates) {
    if (normalizedBody === item.pattern) {
      return item.project;
    }
  }

  // Pass 2: word-boundary match for longer titles/aliases
  for (const item of candidates) {
    if (matchesPattern(normalizedBody, item.pattern)) {
      return item.project;
    }
  }

  return null;
}

export function parseDiscordReport(
  rawContent: string,
  options: {
    projects: ProjectCatalogEntry[];
    channelMappings: ChannelMappingEntry[];
    roleAliases: RoleAliasEntry[];
    explicitMentions?: string[];
    guildChannelMappings?: GuildChannelMappingEntry[];
    mentionedChannels?: MentionedChannelInfo[];
    currentChannelId?: string;
    currentChannelName?: string | null;
  }
): ParsedReportResult {
  const notes: string[] = [];
  const { mentions, stripped } = extractAndStripMentions(
    rawContent,
    options.explicitMentions
  );
  const { mentionedChannelIds, tags, body } = extractChannelReferences(stripped);

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
      extractedTitle: null,
      chapterDisplay: '-',
      role: null,
      roleTokenMatched: null,
      workStatus,
      chapters: [],
      mentions,
      cleanedContent: stripped,
    };
  }

  if (chapterInfo.foundChapterKeyword && chapterInfo.invalidReason) {
    notes.push(chapterInfo.invalidReason);
  }
  if (!chapterInfo.foundChapterKeyword) {
    notes.push('Nomor chapter tidak ditemukan.');
  }

  if (!roleMatch.role) {
    notes.push('Role pekerjaan (ETL/Translator, TS/Editor, atau Solo) tidak dikenali.');
  }

  if (!workStatus) {
    notes.push('Status penyelesaian (Done/Completed/Finish/Finished) tidak ditemukan.');
  }

  const cleanBeforeChapter = sanitizeTitleText(beforeChapterText);
  const comicTags = tags.filter((tag) => !isNonComicChannel(undefined, tag));

  const mappedProjectIds = options.channelMappings.map((m) => m.projectId);
  const defaultMapping =
    options.channelMappings.find((m) => m.isDefault) ??
    (options.channelMappings.length === 1 ? options.channelMappings[0] : null);

  let resolvedProjectId: string | null = null;
  let projectTitleMatched: string | null = null;
  let extractedTitle: string | null = null;
  let hasConflict = false;
  let isAmbiguousProject = false;

  const applyMatchedProject = (project: ProjectCatalogEntry) => {
    resolvedProjectId = project.id;
    projectTitleMatched = project.title;
    extractedTitle = project.title;
    if (mappedProjectIds.length > 0 && !mappedProjectIds.includes(project.id)) {
      hasConflict = true;
      notes.push(
        `Konflik komik: pesan menyebut "${project.title}", sedangkan channel ini ter-mapping ke proyek lain.`
      );
    }
  };

  const applyUnmatchedTitle = (titleCandidate: string) => {
    extractedTitle = titleCandidate;
    if (defaultMapping && mappedProjectIds.length === 1) {
      resolvedProjectId = defaultMapping.projectId;
      hasConflict = true;
      notes.push(
        `Nama komik "${titleCandidate}" tidak dikenal pada daftar komik, perlu pemeriksaan admin.`
      );
    } else {
      isAmbiguousProject = true;
      notes.push(`Komik "${titleCandidate}" tidak ditemukan di database.`);
    }
  };

  // Priority 1: Explicit comic title written before chapter (e.g. after <#1352988212079104031>)
  if (cleanBeforeChapter.length > 0) {
    const matched = matchProjectByText(cleanBeforeChapter, options.projects);
    if (matched) {
      applyMatchedProject(matched);
    } else {
      applyUnmatchedTitle(cleanBeforeChapter);
    }
  } else if (comicTags.length > 0) {
    // Priority 2: Leading comic hashtag like #Solo-Leveling (excluding #file-tl etc.)
    let matchedFromTag: ProjectCatalogEntry | null = null;
    for (const tag of comicTags) {
      const normalizedTitle = normalizeChannelNameToTitle(tag);
      const found = matchProjectByText(normalizedTitle, options.projects);
      if (found) {
        matchedFromTag = found;
        break;
      }
    }
    if (matchedFromTag) {
      applyMatchedProject(matchedFromTag);
    } else {
      const normalizedTagTitle = normalizeChannelNameToTitle(comicTags[0]);
      applyUnmatchedTitle(normalizedTagTitle);
    }
  } else {
    // Priority 3: Mentioned Discord comic channel <#channel_id> (excluding #file-tl / non-comic channels)
    let resolvedFromMentionedChannel = false;
    const mentionedChannelNameMap = new Map<string, string>();
    for (const mc of options.mentionedChannels ?? []) {
      if (mc.id && mc.name) {
        mentionedChannelNameMap.set(mc.id, mc.name);
      }
    }

    for (const chId of mentionedChannelIds) {
      const dbMappings = (options.guildChannelMappings ?? []).filter(
        (m) => m.discordChannelId === chId
      );
      const knownName =
        mentionedChannelNameMap.get(chId) ||
        dbMappings.find((m) => m.channelName)?.channelName ||
        null;

      if (isNonComicChannel(chId, knownName)) {
        continue;
      }

      // 3a. Check if the mentioned channel is mapped to a project in DB
      const dbDefault =
        dbMappings.find((m) => m.projectId && m.isDefault) ??
        dbMappings.find((m) => m.projectId);
      if (dbDefault?.projectId) {
        const mappedProj = options.projects.find((p) => p.id === dbDefault.projectId);
        if (mappedProj) {
          applyMatchedProject(mappedProj);
          resolvedFromMentionedChannel = true;
          break;
        }
      }

      // 3b. Otherwise resolve via the mentioned channel's normalized name (e.g. Solo-Leveling -> Solo Leveling)
      if (knownName) {
        const normalizedChTitle = normalizeChannelNameToTitle(knownName);
        if (normalizedChTitle) {
          const matched = matchProjectByText(normalizedChTitle, options.projects);
          if (matched) {
            applyMatchedProject(matched);
          } else {
            applyUnmatchedTitle(normalizedChTitle);
          }
          resolvedFromMentionedChannel = true;
          break;
        }
      }
    }

    // Priority 4: Fallback to current channel mapping or current comic channel name
    if (!resolvedFromMentionedChannel) {
      if (defaultMapping) {
        resolvedProjectId = defaultMapping.projectId;
        const matchedProj = options.projects.find((p) => p.id === defaultMapping.projectId);
        projectTitleMatched = matchedProj?.title ?? null;
        extractedTitle = matchedProj?.title ?? null;
      } else if (mappedProjectIds.length > 1) {
        isAmbiguousProject = true;
        notes.push(
          'Channel ini terhubung ke lebih dari 1 komik dan nama komik tidak ditulis di pesan.'
        );
      } else if (
        options.currentChannelName &&
        !isNonComicChannel(options.currentChannelId, options.currentChannelName)
      ) {
        const normalizedCurrentTitle = normalizeChannelNameToTitle(options.currentChannelName);
        if (normalizedCurrentTitle) {
          const matched = matchProjectByText(normalizedCurrentTitle, options.projects);
          if (matched) {
            resolvedProjectId = matched.id;
            projectTitleMatched = matched.title;
            extractedTitle = matched.title;
          } else {
            extractedTitle = normalizedCurrentTitle;
            isAmbiguousProject = true;
            notes.push(`Komik "${normalizedCurrentTitle}" belum terdaftar di database.`);
          }
        } else {
          isAmbiguousProject = true;
          notes.push('Channel belum di-mapping ke komik dan nama komik tidak ditulis.');
        }
      } else {
        isAmbiguousProject = true;
        notes.push('Channel belum di-mapping ke komik dan nama komik tidak ditulis.');
      }
    }
  }

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
    extractedTitle,
    chapterDisplay: chapterInfo.chapterDisplay,
    role: roleMatch.role,
    roleTokenMatched: roleMatch.matchedToken,
    workStatus,
    chapters: chapterInfo.chapters,
    mentions,
    cleanedContent: stripped,
  };
}
