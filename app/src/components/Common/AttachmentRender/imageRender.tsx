import { useEffect, useMemo, useState } from 'react';
import { FileType } from '../Editor/type';
import { Image } from '@heroui/react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import { Icon } from '@/components/Common/Iconify/icons';
import { DeleteIcon, DownloadIcon, InsertConextButton, CopyIcon } from './icons';
import { observer } from 'mobx-react-lite';
import { useMediaQuery } from 'usehooks-ts';
import { DraggableFileGrid } from './DraggableFileGrid';
import axiosInstance from '@/lib/axios';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import { ImageCacheStore } from '@/store/cache/imageCacheStore';
import { BaseStore } from '@/store/baseStore';

type IProps = {
  files: FileType[]
  preview?: boolean
  columns?: number
  onReorder?: (newFiles: FileType[]) => void
}
export const ImageThumbnailRender = ({ src, className }: { src: string, className?: string }) => {
  const [isOriginalError, setIsOriginalError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState('');
  const [loading, setLoading] = useState(true);
  const userStore = RootStore.Get(UserStore);
  const imageCacheStore = RootStore.Get(ImageCacheStore);
  const baseStore = RootStore.Get(BaseStore);

  useEffect(() => {
    let objectUrl = '';

    const fetchImage = async () => {
      setLoading(true);
      const token = userStore.tokenData.value?.token;

      // Extract attachment ID from src (format: /api/v1/file/123)
      const attachmentIdMatch = src.match(/\/file\/(\d+)/);
      const attachmentId = attachmentIdMatch ? parseInt(attachmentIdMatch[1]) : null;

      // Try to get from cache first (offline or online)
      if (attachmentId) {
        try {
          const cachedBlob = await imageCacheStore.getImage(attachmentId);
          if (cachedBlob) {
            objectUrl = URL.createObjectURL(cachedBlob);
            setCurrentSrc(objectUrl);
            setLoading(false);
            return;
          }
        } catch (error) {
          console.log('[Image] Cache lookup failed:', error);
        }
      }

      // If not in cache and offline, show fallback
      if (!baseStore.isOnline) {
        console.log('[Image] Offline and not cached, showing fallback');
        setIsOriginalError(true);
        setLoading(false);
        return;
      }

      // Online: fetch from server
      try {
        // Try 1: Get thumbnail with Authorization header (via axios interceptor)
        const response = await axiosInstance.get(getBlinkoEndpoint(`${src}?thumbnail=true`), {
          responseType: 'blob'
        });

        objectUrl = URL.createObjectURL(response.data);
        setCurrentSrc(objectUrl);

        // Cache the image for offline use
        if (attachmentId) {
          imageCacheStore.cacheImage(attachmentId, response.data).catch(err => {
            console.warn('[Image] Failed to cache:', err);
          });
        }
      } catch (error: any) {
        if (error?.response?.status === 401 && token) {
          // Try 2: Retry with token in query param
          try {
            const response = await axiosInstance.get(
              getBlinkoEndpoint(`${src}?thumbnail=true&token=${token}`),
              { responseType: 'blob' }
            );

            objectUrl = URL.createObjectURL(response.data);
            setCurrentSrc(objectUrl);

            // Cache the image
            if (attachmentId) {
              imageCacheStore.cacheImage(attachmentId, response.data).catch(err => {
                console.warn('[Image] Failed to cache:', err);
              });
            }
            return;
          } catch (error2) {
            console.error('[Image] Token query param failed:', error2);
          }
        }

        // Try 3: Original image
        try {
          const response = await axiosInstance.get(src, {
            responseType: 'blob'
          });

          objectUrl = URL.createObjectURL(response.data);
          setCurrentSrc(objectUrl);

          // Cache the image
          if (attachmentId) {
            imageCacheStore.cacheImage(attachmentId, response.data).catch(err => {
              console.warn('[Image] Failed to cache:', err);
            });
          }
        } catch (error) {
          console.error('[Image] All attempts failed:', error);
          // If all fail, use fallback
          setIsOriginalError(true);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchImage();

    // Clean up created object URLs when component unmounts
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src, userStore.tokenData.value?.token, baseStore.isOnline]);

  useEffect(() => {
    if (isOriginalError) {
      setCurrentSrc('/image-fallback.svg')
    }
  }, [isOriginalError])

  return (
    <>
      {loading && (
        <div className="flex items-center justify-center w-full h-full">
          <Icon icon="line-md:loading-twotone-loop" width="24" height="24" />
        </div>
      )}
      {!loading && (
        <Image
          src={currentSrc}
          classNames={{
            wrapper: '!max-w-full',
          }}
          draggable={false}
          onError={() => {
            setIsOriginalError(true);
          }}
          className={`object-cover w-full ${className}`}
        />
      )}
    </>
  );
}

const ImageRender = observer((props: IProps) => {
  const { files, preview = false, columns } = props
  const isPc = useMediaQuery('(min-width: 768px)')

  const imageRenderClassName = useMemo(() => {
    if (!preview) {
      return 'flex flex-row gap-2 overflow-x-auto pb-2'
    }
    return 'flex flex-wrap gap-2'
  }, [preview, columns])

  const imageHeight = useMemo(() => {
    if (!preview) {
      return 'h-[160px] w-[160px]'
    }
    return 'md:h-[180px] md:w-[180px] h-[100px] w-[100px] object-cover'
  }, [preview, columns])

  const renderImage = (file: FileType) => (
    <div className={`relative group ${!preview ? 'min-w-[160px] flex-shrink-0' : ''} ${imageHeight}`}>
      {file.uploadPromise?.loading?.value && (
        <div className='absolute inset-0 flex items-center justify-center w-full h-full'>
          <Icon icon="line-md:uploading-loop" width="40" height="40" />
        </div>
      )}
      <div className='w-full'>
        <PhotoView src={getBlinkoEndpoint(`${file.preview}?token=${RootStore.Get(UserStore).tokenData.value?.token}`)}>
          <div>
            <ImageThumbnailRender
              src={file.preview}
              className={`mb-4 ${imageHeight} object-cover md:w-[1000px]`}
            />
          </div>
        </PhotoView>
      </div>
      {!file.uploadPromise?.loading?.value && !preview &&
        <InsertConextButton className='absolute z-10 left-[5px] top-[5px]' files={files} file={file} />
      }
      {!file.uploadPromise?.loading?.value && !preview &&
        <DeleteIcon className='absolute z-10 right-[5px] top-[5px]' files={files} file={file} />
      }
      {preview && (
        <>
          <CopyIcon file={file} />
          <DownloadIcon file={file} />
        </>
      )}
    </div>
  )

  return (
    <PhotoProvider>
      <DraggableFileGrid
        files={files}
        preview={preview}
        columns={columns}
        type="image"
        className={imageRenderClassName}
        renderItem={renderImage}
        onReorder={props.onReorder}
      />
    </PhotoProvider>
  )
})

export { ImageRender }