import { MarkdownRender } from '@/components/Common/MarkdownRender';
import { FilesAttachmentRender } from "../Common/AttachmentRender";
import { Note } from '@shared/lib/types';
import { BlinkoStore } from '@/store/blinkoStore';
import { observer } from 'mobx-react-lite';
import { ReferencesContent } from './referencesContent';
import { isCredentialsNote, maskCredentialsContent } from '@/lib/notePrivacy';

interface NoteContentProps {
  blinkoItem: Note;
  blinko: BlinkoStore;
  isExpanded?: boolean;
  isShareMode?: boolean;
}

export const NoteContent = observer(({ blinkoItem, blinko, isExpanded, isShareMode }: NoteContentProps) => {
  const shouldMask = isCredentialsNote(blinkoItem);
  const renderContent = shouldMask ? maskCredentialsContent(blinkoItem.content ?? '') : blinkoItem.content;

  return (
    <>
      <MarkdownRender
        content={renderContent}
        onChange={
          shouldMask
            ? undefined
            : (newContent) => {
              if (isShareMode) return;
              blinkoItem.content = newContent
              blinko.upsertNote.call({ id: blinkoItem.id, content: newContent, refresh: false })
            }
        }
        isShareMode={isShareMode}
        largeSpacing={isShareMode || isExpanded}
      />
      {!shouldMask && (
        <>
          <ReferencesContent blinkoItem={blinkoItem} className={`${isExpanded ? 'my-4' : 'my-2'}`} />
          <div className={blinkoItem.attachments?.length != 0 ? 'my-2' : ''}>
            <FilesAttachmentRender files={blinkoItem.attachments ?? []} preview />
          </div>
        </>
      )}
    </>
  );
});
