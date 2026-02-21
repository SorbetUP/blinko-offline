import { RootStore } from "@/store";
import { ResourceStore } from "@/store/resourceStore";
import { observer } from "mobx-react-lite";
import { useMemo, useCallback } from "react";
import { ScrollArea } from "@/components/Common/ScrollArea";
import { Icon } from '@/components/Common/Iconify/icons';
import { useTranslation } from "react-i18next";
import { DragDropContext, Droppable } from 'react-beautiful-dnd-next';
import { toJS } from "mobx";
import { MemoizedResourceItem } from "@/components/BlinkoResource/ResourceItem";
import { ResourceMultiSelectPop } from "@/components/BlinkoResource/ResourceMultiSelectpop";
import { Breadcrumbs, BreadcrumbItem, Button } from "@heroui/react";
import { AnimatePresence, motion } from "framer-motion";
import { LoadingAndEmpty } from "@/components/Common/LoadingAndEmpty";
import { PhotoProvider } from "react-photo-view";
import { useNavigate } from "react-router-dom";
import { useMediaQuery } from "usehooks-ts";
const Page = observer(() => {
  const navigate = useNavigate();
  const resourceStore = RootStore.Get(ResourceStore);
  const { t } = useTranslation();
  const isPc = useMediaQuery('(min-width: 768px)');
  const dndEnabled = isPc;
  const motionEnabled = isPc;
  const resources = useMemo(() => {
    const allResources = toJS(resourceStore.blinko.resourceList.value) || [];
    // Filter out .folder placeholder files
    return allResources.filter(resource => resource.name !== '.folder');
  }, [resourceStore.blinko.resourceList.value]);

  const selectedItems = resourceStore.selectedItems;

  const handleMoveSelectedToParent = useCallback(async () => {
    if (!resourceStore.currentFolder) return;
    const selectedResources = Array.from(selectedItems)
      .map(id => resources.find(r => r.id === id))
      .filter((item): item is NonNullable<typeof item> => item != null);

    if (selectedResources.length > 0) {
      await resourceStore.moveToParentFolder(selectedResources);
    }
  }, [resourceStore, selectedItems, resources]);

  const folderBreadcrumbs = useMemo(() => {
    if (!resourceStore.currentFolder) return [];
    return ['Root', ...resourceStore.currentFolder.split('/')];
  }, [resourceStore.currentFolder]);

  resourceStore.use();

  const content = (
    <ScrollArea
      fixMobileTopBar
      onBottom={resourceStore.loadNextPage}
      className="md:px-6 h-[calc(100%_-_5px)] md:h-[calc(100vh_-_100px)] px-2 md:max-w-[1000px] w-full overflow-x-hidden mx-auto"
    >
      <div className="flex items-center justify-between ">
        <div className="flex items-center gap-2">
          {resourceStore.currentFolder && (
            motionEnabled ? (
              <AnimatePresence mode="wait">
                <motion.div
                  key={resourceStore.currentFolder}
                  initial={{ y: -10, opacity: 0, height: 0 }}
                  animate={{ y: 0, opacity: 1, height: "auto" }}
                  exit={{ y: -10, opacity: 0, height: 0 }}
                  transition={{
                    type: "spring",
                    stiffness: 500,
                    damping: 30,
                    duration: 0.15
                  }}
                >
                  <Breadcrumbs variant="solid" className="ml-[-8px]" size='lg'>
                    {folderBreadcrumbs.map((folder, index) => (
                      <BreadcrumbItem
                        key={folder}
                        onPress={() => {
                          if (index === 0) {
                            resourceStore.navigateBack(navigate);
                          } else {
                            const currentPathSegments = resourceStore.currentFolder?.split('/') || [];
                            const clickedPathLevel = index;
                            const stepsToGoBack = currentPathSegments.length - clickedPathLevel;

                            for (let i = 0; i < stepsToGoBack; i++) {
                              resourceStore.navigateBack(navigate);
                            }
                          }
                        }}
                      >
                        {folder}
                      </BreadcrumbItem>
                    ))}
                  </Breadcrumbs>
                </motion.div>
              </AnimatePresence>
            ) : (
              <Breadcrumbs variant="solid" className="ml-[-8px]" size='lg'>
                {folderBreadcrumbs.map((folder, index) => (
                  <BreadcrumbItem
                    key={folder}
                    onPress={() => {
                      if (index === 0) {
                        resourceStore.navigateBack(navigate);
                      } else {
                        const currentPathSegments = resourceStore.currentFolder?.split('/') || [];
                        const clickedPathLevel = index;
                        const stepsToGoBack = currentPathSegments.length - clickedPathLevel;

                        for (let i = 0; i < stepsToGoBack; i++) {
                          resourceStore.navigateBack(navigate);
                        }
                      }
                    }}
                  >
                    {folder}
                  </BreadcrumbItem>
                ))}
              </Breadcrumbs>
            )
          )}
        </div>

        <div className="flex items-center gap-2 mt-2 ">
          <motion.div
            initial={motionEnabled ? { x: 20, opacity: 0 } : false}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 20, opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 25
            }}
          >
            <Button
              size="sm"
              color="primary"
              onPress={resourceStore.handleNewFolder}
              startContent={<Icon icon="material-symbols:create-new-folder-outline" className="w-5 h-5" />}
            >
              {t('new-folder')}
            </Button>
          </motion.div>

          <motion.div
            initial={motionEnabled ? { x: 20, opacity: 0 } : false}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 20, opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 25
            }}
          >
            <Button
              size="sm"
              variant="bordered"
              onPress={() => {
                if (selectedItems.size === resources.length) {
                  resourceStore.clearSelection();
                } else {
                  resourceStore.selectAllFiles(resources);
                }
              }}
              startContent={
                <Icon
                  icon={
                    selectedItems.size === resources.length
                      ? "material-symbols:deselect"
                      : "material-symbols:select-all"
                  }
                  className="w-5 h-5"
                />
              }
            >
              {selectedItems.size === resources.length ? t('deselect-all') : t('select-all')}
            </Button>
          </motion.div>

          {selectedItems.size > 0 && resourceStore.currentFolder && resourceStore.currentFolder !== 'Root' && (
            <motion.div
              initial={motionEnabled ? { x: 20, opacity: 0 } : false}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 20, opacity: 0 }}
              transition={{
                type: "spring",
                stiffness: 300,
                damping: 25
              }}
            >
              <Button
                variant="light"
                onPress={handleMoveSelectedToParent}
                startContent={<Icon icon="material-symbols:drive-file-move-outline" className="w-5 h-5" />}
              >
                {t('move-to-parent')}
              </Button>
            </motion.div>
          )}
        </div>
      </div>

      <LoadingAndEmpty
        isLoading={resourceStore.blinko.resourceList.isLoading}
        isEmpty={!resources.length}
        emptyMessage={t('no-resources-found')}
      />
      <PhotoProvider>
        {resources.length > 0 && (
          dndEnabled ? (
            <Droppable droppableId="resources">
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="py-2 min-h-[200px]"
                >
                  {resources.map((item, index) => (
                    <MemoizedResourceItem
                      key={item.isFolder ? `folder-${item.folderName}` : `file-${item.id}`}
                      item={item}
                      index={index}
                      isSelected={selectedItems.has(item.id!)}
                      onSelect={resourceStore.toggleSelect}
                      onFolderClick={(folder) => resourceStore.navigateToFolder(folder, navigate)}
                      dndEnabled
                    />
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          ) : (
            <div className="py-2 min-h-[200px]">
              {resources.map((item, index) => (
                <MemoizedResourceItem
                  key={item.isFolder ? `folder-${item.folderName}` : `file-${item.id}`}
                  item={item}
                  index={index}
                  isSelected={selectedItems.has(item.id!)}
                  onSelect={resourceStore.toggleSelect}
                  onFolderClick={(folder) => resourceStore.navigateToFolder(folder, navigate)}
                  dndEnabled={false}
                />
              ))}
            </div>
          )
        )}
      </PhotoProvider>
    </ScrollArea>
  );

  return (
    <>
      {dndEnabled ? (
        <DragDropContext onDragEnd={resourceStore.handleDragEnd}>
          {content}
        </DragDropContext>
      ) : (
        content
      )}
      <ResourceMultiSelectPop />
    </>
  );
});

export default Page;
