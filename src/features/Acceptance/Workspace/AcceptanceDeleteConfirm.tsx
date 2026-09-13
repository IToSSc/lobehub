'use client';

import { Flexbox } from '@lobehub/ui';
import {
  Button,
  createModal,
  type ModalInstance,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { t } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import { type AcceptancePurgePreview, verifyService } from '@/services/verify';
import { formatSize } from '@/utils/format';

import { frostedModalStyles } from '../Viewer/Review/modals';

const sumPurgePreviews = (previews: AcceptancePurgePreview[]): AcceptancePurgePreview =>
  previews.reduce(
    (total, preview) => ({
      bytes: total.bytes + preview.bytes,
      fileCount: total.fileCount + preview.fileCount,
      files: {
        images: total.files.images + preview.files.images,
        other: total.files.other + preview.files.other,
        videos: total.files.videos + preview.files.videos,
      },
      rounds: total.rounds + preview.rounds,
    }),
    { bytes: 0, fileCount: 0, files: { images: 0, other: 0, videos: 0 }, rounds: 0 },
  );

const PREVIEW_FAN_OUT_LIMIT = 20;

const styles = createStaticStyles(({ css }) => ({
  facts: css`
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 14px;

    margin: 0;
    padding-block: 10px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusLG};

    font-size: 13px;
    font-variant-numeric: tabular-nums;

    background: ${cssVar.colorFillQuaternary};

    dt {
      margin: 0;
      color: ${cssVar.colorTextTertiary};
    }

    dd {
      margin: 0;
      color: ${cssVar.colorText};
    }
  `,
}));

interface DeleteConfirmProps {
  ids: string[];
  onDelete: () => Promise<unknown>;
  title?: string;
}

const usePurgePreview = (ids: string[]) =>
  useClientDataSWR(
    ids.length > PREVIEW_FAN_OUT_LIMIT ? null : verifyKeys.acceptancePurgePreview(ids.join(',')),
    async () =>
      sumPurgePreviews(
        await Promise.all(ids.map((id) => verifyService.getAcceptancePurgePreview(id))),
      ),
  );

const DeleteConfirmContent = memo<DeleteConfirmProps>(({ ids, onDelete }) => {
  const { t: translate } = useTranslation('verify');
  const { close } = useModalContext();
  const [pending, setPending] = useState(false);
  const { data: preview } = usePurgePreview(ids);
  const batch = ids.length > 1;

  const run = async () => {
    setPending(true);
    try {
      await onDelete();
      close();
    } catch (error) {
      console.error('[acceptance:deleteConfirm]', error);
      toast.error(translate('acceptance.workspace.deleteError'));
    } finally {
      setPending(false);
    }
  };

  const okLabel = !preview
    ? batch
      ? translate('acceptance.workspace.deleteConfirm.okBatchPlain', { count: ids.length })
      : translate('actions.delete')
    : batch
      ? translate('acceptance.workspace.deleteConfirm.okBatch', {
          count: ids.length,
          size: formatSize(preview.bytes),
        })
      : translate('acceptance.workspace.deleteConfirm.ok', { size: formatSize(preview.bytes) });

  return (
    <Flexbox gap={12}>
      <Text fontSize={13} type={'secondary'}>
        {translate(
          batch
            ? 'acceptance.workspace.batch.deleteConfirmDescription'
            : 'acceptance.workspace.deleteConfirmDescription',
        )}
      </Text>
      {preview && (
        <dl className={styles.facts}>
          <dt>{translate('acceptance.workspace.deleteConfirm.rounds')}</dt>
          <dd>
            {translate('acceptance.workspace.deleteConfirm.roundsValue', { count: preview.rounds })}
          </dd>
          <dt>{translate('acceptance.workspace.deleteConfirm.files')}</dt>
          <dd>
            {translate('acceptance.workspace.deleteConfirm.filesValue', {
              count: preview.fileCount,
              ...preview.files,
            })}
          </dd>
          <dt>{translate('acceptance.workspace.deleteConfirm.space')}</dt>
          <dd>{formatSize(preview.bytes)}</dd>
        </dl>
      )}
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={pending} onClick={close}>
          {translate('actions.cancel')}
        </Button>
        <Button danger loading={pending} type={'primary'} onClick={() => void run()}>
          {okLabel}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

DeleteConfirmContent.displayName = 'AcceptanceDeleteConfirmContent';

export const openAcceptanceDeleteConfirm = (options: DeleteConfirmProps): ModalInstance =>
  createModal({
    content: <DeleteConfirmContent {...options} />,
    footer: null,
    maskClosable: true,
    styles: frostedModalStyles,
    title:
      options.ids.length > 1
        ? t('acceptance.workspace.batch.deleteConfirmTitle', {
            count: options.ids.length,
            ns: 'verify',
          })
        : t('acceptance.workspace.deleteConfirmTitle', { ns: 'verify', title: options.title }),
    width: 'min(90vw, 440px)',
  });
