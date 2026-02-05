import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { Context } from '@server/context';
import { userCaller } from '@server/routerTrpc/_app';
import { NoteType, ProgressResult } from '@shared/lib/types';
import { FileService } from '@server/lib/files';
import { UPLOAD_FILE_PATH } from '@shared/lib/pathConstant';
import { prisma } from '../prisma';

interface KeepLabel {
  name?: string;
}

interface KeepListItem {
  text?: string;
  isChecked?: boolean;
}

interface KeepAttachment {
  filePath?: string;
  mimetype?: string;
}

interface KeepNote {
  title?: string;
  textContent?: string;
  listContent?: KeepListItem[];
  labels?: KeepLabel[];
  isArchived?: boolean;
  isTrashed?: boolean;
  isPinned?: boolean;
  createdTimestampUsec?: number | string;
  userEditedTimestampUsec?: number | string;
  attachments?: KeepAttachment[];
}

type AttachmentUpload = {
  name: string;
  path: string;
  size: number;
  type: string;
};

export class GoogleKeepImporter {
  private extractPath?: string;

  private async processZipFile(zipFilePath: string): Promise<string> {
    const zip = new AdmZip(zipFilePath);
    const extractPath = path.join(UPLOAD_FILE_PATH, `google_keep_extract_${Date.now()}`);
    if (!fs.existsSync(extractPath)) {
      fs.mkdirSync(extractPath, { recursive: true });
    }
    zip.extractAllTo(extractPath, true);
    this.extractPath = extractPath;
    return extractPath;
  }

  private findKeepRoot(rootDir: string): string {
    const queue: string[] = [rootDir];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.toLowerCase() === 'keep') {
            return full;
          }
          queue.push(full);
        }
      }
    }
    return rootDir;
  }

  private collectJsonFiles(rootDir: string): string[] {
    const jsonFiles: string[] = [];
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
          jsonFiles.push(full);
        }
      }
    };
    walk(rootDir);
    return jsonFiles;
  }

  private buildFileIndex(rootDir: string): Map<string, string> {
    const index = new Map<string, string>();
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          const rel = path.relative(rootDir, full).replace(/\\/g, '/');
          if (!index.has(rel)) index.set(rel, full);
          if (!index.has(entry.name)) index.set(entry.name, full);
        }
      }
    };
    walk(rootDir);
    return index;
  }

  private parseKeepJson(filePath: string): KeepNote | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as KeepNote;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  private normalizeLabel(label?: string): string {
    if (!label) return '';
    return label.replace(/#/g, '').trim().replace(/\s+/g, '-');
  }

  private formatKeepText(text?: string): string {
    if (!text) return '';
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return normalized.trimEnd().replace(/\n/g, '  \n');
  }

  private buildAutoTags(content: string): string[] {
    const text = content.toLowerCase();
    const tags: string[] = [];

    const hasAny = (patterns: RegExp[]) => patterns.some((pattern) => pattern.test(text));

    if (hasAny([/mot de passe/, /\bpassword\b/, /\bmdp\b/, /\blogin\b/, /\bidentifiant\b/, /\busername\b/, /\bapi key\b/, /\btoken\b/])) {
      tags.push('credentials');
    }
    if (hasAny([/\bemail\b/, /\bmail\b/, /\bobjet\s*:/, /\bbonjour\b/, /\bcordialement\b/, /\bdear\b/, /\bsincerely\b/])) {
      tags.push('email-draft');
    }
    if (hasAny([/\barticle\b/, /\bblog\b/, /\boutline\b/, /\bintroduction\b/, /\bconclusion\b/])) {
      tags.push('article');
    }
    if (hasAny([/\bcours\b/, /\blecture\b/, /\bchapitre\b/, /\btd\b/, /\btp\b/, /\bexercice\b/])) {
      tags.push('course');
    }
    if (hasAny([/\bréflexion\b/, /\breflexion\b/, /\bjournal\b/, /\bthoughts\b/, /\bidea\b/, /\bidée\b/])) {
      tags.push('reflection');
    }
    if (hasAny([/\btodo\b/, /\bto-do\b/, /\bchecklist\b/, /\-\s+\[ \]/])) {
      tags.push('todo');
    }
    if (hasAny([/\bmeeting\b/, /\bréunion\b/, /\bagenda\b/])) {
      tags.push('meeting');
    }
    if (hasAny([/```/, /\bfunction\b/, /\bclass\b/, /\bconst\b/, /\bvar\b/])) {
      tags.push('code');
    }
    if (hasAny([/\bbudget\b/, /\bfacture\b/, /\binvoice\b/, /\biban\b/, /\brib\b/, /\b€\b/, /\$\b/])) {
      tags.push('finance');
    }

    return tags;
  }

  private buildContent(note: KeepNote, attachmentLinks: string[], autoTagsEnabled: boolean): string {
    const parts: string[] = [];
    const title = note.title?.trim();
    if (title) {
      parts.push(`# ${title}`);
    }

    const text = this.formatKeepText(note.textContent);
    if (text) {
      parts.push(text);
    }

    if (note.listContent && note.listContent.length > 0) {
      const items = note.listContent
        .map((item) => {
          const label = item.text?.trim();
          if (!label) return null;
          const checked = item.isChecked ? '[x]' : '[ ]';
          return `- ${checked} ${label}`;
        })
        .filter(Boolean) as string[];
      if (items.length > 0) {
        parts.push(items.join('\n'));
      }
    }

    if (attachmentLinks.length > 0) {
      parts.push(attachmentLinks.join('\n'));
    }

    const labels = (note.labels || [])
      .map((label) => this.normalizeLabel(label.name))
      .filter(Boolean)
      .map((label) => `#${label}`);
    const baseContent = parts.join('\n\n').trim();
    const autoTags = autoTagsEnabled
      ? this.buildAutoTags(baseContent).filter(Boolean).map((tag) => `#${tag}`)
      : [];

    const tagLine = [...labels, ...autoTags].filter(Boolean);
    if (tagLine.length > 0) {
      parts.push(tagLine.join(' '));
    }

    return parts.join('\n\n').trim();
  }

  private parseTimestamp(ts?: number | string): Date | undefined {
    if (ts === undefined || ts === null) return undefined;
    const num = typeof ts === 'string' ? Number(ts) : ts;
    if (!Number.isFinite(num) || num <= 0) return undefined;
    return new Date(num / 1000);
  }

  private async uploadAttachments(
    note: KeepNote,
    fileIndex: Map<string, string>,
    accountId: number,
  ): Promise<{ attachments: AttachmentUpload[]; links: string[] }> {
    const attachments: AttachmentUpload[] = [];
    const links: string[] = [];

    const keepAttachments = note.attachments || [];
    for (const attachment of keepAttachments) {
      const filePath = attachment.filePath?.replace(/\\/g, '/');
      if (!filePath) continue;
      const resolved = fileIndex.get(filePath) || fileIndex.get(path.basename(filePath));
      if (!resolved) {
        links.push(`- Attachment missing: ${path.basename(filePath)}`);
        continue;
      }
      try {
        const buffer = await fs.promises.readFile(resolved);
        const originalName = path.basename(resolved);
        const type = attachment.mimetype || '';
        const { filePath: apiPath, fileName } = await FileService.uploadFile({
          buffer,
          originalName,
          type,
          accountId,
          withOutAttachment: false,
        });
        attachments.push({
          name: fileName,
          path: apiPath,
          size: buffer.length,
          type,
        });
        if (type.startsWith('image/')) {
          links.push(`![${fileName}](${apiPath})`);
        } else {
          links.push(`[${fileName}](${apiPath})`);
        }
      } catch (error) {
        links.push(`- Failed to import attachment: ${path.basename(filePath)}`);
      }
    }

    return { attachments, links };
  }

  async *importKeep(
    filePath: string,
    ctx: Context,
    options?: { autoTags?: boolean },
  ): AsyncGenerator<ProgressResult & { progress?: { current: number; total: number } }, void, unknown> {
    const autoTagsEnabled = options?.autoTags ?? true;
    try {
      let rootDir = '';
      let jsonFiles: string[] = [];
      const fileExt = path.extname(filePath).toLowerCase();

      if (fileExt === '.zip') {
        const extractPath = await this.processZipFile(filePath);
        const keepRoot = this.findKeepRoot(extractPath);
        rootDir = keepRoot;
        jsonFiles = this.collectJsonFiles(keepRoot);
      } else if (fileExt === '.json') {
        rootDir = path.dirname(filePath);
        jsonFiles = [filePath];
      } else {
        throw new Error('Unsupported file type. Only .zip or .json files are supported.');
      }

      if (jsonFiles.length === 0) {
        throw new Error('No Google Keep JSON files found in the provided export.');
      }

      const fileIndex = this.buildFileIndex(rootDir);
      const total = jsonFiles.length;

      for (let i = 0; i < jsonFiles.length; i++) {
        const jsonPath = jsonFiles[i];
        const note = this.parseKeepJson(jsonPath);
        if (!note) {
          yield {
            type: 'error',
            content: `Failed to parse: ${path.basename(jsonPath)}`,
            progress: { current: i + 1, total },
          };
          continue;
        }

        const accountId = Number(ctx.id);
        const { attachments, links } = await this.uploadAttachments(note, fileIndex, accountId);
        const hasTextContent = Boolean(
          note.title?.trim() ||
          note.textContent?.trim() ||
          (note.listContent || []).some((item) => item.text?.trim()),
        );
        const effectiveNote = (!hasTextContent && (note.attachments || []).length > 0)
          ? { ...note, title: note.title?.trim() || '(Sans titre)' }
          : note;

        const content = this.buildContent(effectiveNote, links, autoTagsEnabled);
        if (!content) {
          yield {
            type: 'skip',
            content: `Skipped empty note: ${path.basename(jsonPath)}`,
            progress: { current: i + 1, total },
          };
          continue;
        }

        const existing = await prisma.notes.findFirst({
          where: { content, accountId },
          select: { id: true, isTop: true },
        });
        if (existing) {
          if (note.isPinned && !existing.isTop) {
            await prisma.notes.update({
              where: { id: existing.id },
              data: { isTop: true },
            });
          }
          yield {
            type: 'skip',
            content: `Skipped duplicate: ${path.basename(jsonPath)}`,
            progress: { current: i + 1, total },
          };
          continue;
        }

        await userCaller(ctx).notes.upsert({
          content,
          type: NoteType.NOTE,
          isArchived: note.isArchived ?? false,
          isRecycle: note.isTrashed ?? false,
          isTop: note.isPinned ?? false,
          attachments,
          createdAt: this.parseTimestamp(note.createdTimestampUsec),
          updatedAt: this.parseTimestamp(note.userEditedTimestampUsec),
        });

        yield {
          type: 'success',
          content: note.title ? `Imported: ${note.title}` : `Imported: ${path.basename(jsonPath)}`,
          progress: { current: i + 1, total },
        };
      }

      yield {
        type: 'success',
        content: 'Google Keep import completed',
        progress: { current: total, total },
      };
    } catch (error) {
      yield {
        type: 'error',
        content: `Error during import: ${error instanceof Error ? error.message : String(error)}`,
        error,
        progress: { current: 0, total: 1 },
      };
    } finally {
      if (this.extractPath) {
        try {
          fs.rmSync(this.extractPath, { recursive: true, force: true });
        } catch (_) {
          // ignore cleanup errors
        }
      }
    }
  }
}
