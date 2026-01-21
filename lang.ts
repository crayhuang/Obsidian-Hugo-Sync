export interface LanguageStrings {
  settings: {
    pluginName: string;
    hugoPath: string;
    hugoPathDesc: string;
    contentPath: string;
    contentPathDesc: string;
    filteredHeaders: string;
    filteredHeadersDesc: string;
    staticPath: string;
    staticPathDesc: string;
    imageSubPath: string;
    imageSubPathDesc: string;
    obsidianAttachmentInfo: string;
    imageSearchInfo: string;
  };
  notices: {
    syncSuccess: string;
    syncError: string;
    noFilesSelected: string;
    syncResult: string;
    syncErrors: string;
    imageSyncSuccess: string;
    imageSyncError: string;
  };
}

const en: LanguageStrings = {
  settings: {
    pluginName: "Hugo Sync Settings",
    hugoPath: "Hugo Path",
    hugoPathDesc: "Path to your Hugo project",
    contentPath: "Content Path",
    contentPathDesc: "Path to Hugo content directory (relative to Hugo Path)",
    filteredHeaders: "Filtered Headers",
    filteredHeadersDesc: "Enter headers to be filtered from Hugo content (one per line)",
    staticPath: "Static Path",
    staticPathDesc: "Path to Hugo static directory (relative to Hugo Path)",
    imageSubPath: "Image Sub Path",
    imageSubPathDesc: "Sub directory for images within static path (e.g., 'images')",
    obsidianAttachmentInfo: "Obsidian Attachment Settings",
    imageSearchInfo: "Images will be searched in the directories you specify below",
    imageSearchPaths: "Image Search Directories",
    imageSearchPathsDesc: "Enter directories to search for images (one per line)",
  },
  notices: {
    syncSuccess: "Synced {0} file(s) to Hugo",
    syncError: "Error syncing to Hugo: {0}",
    noFilesSelected: "No files selected for syncing",
    syncResult: "Sync complete. Total: {0}, Success: {1}, Failed: {2}",
    syncErrors: "Errors occurred during sync",
    imageSyncSuccess: "Synced {0} image(s) for {1}",
    imageSyncError: "Failed to sync image {0}: {1}",
  },
};

const zh: LanguageStrings = {
  settings: {
    pluginName: "Hugo 同步设置",
    hugoPath: "Hugo 路径",
    hugoPathDesc: "Hugo 项目的路径",
    contentPath: "内容路径",
    contentPathDesc: "Hugo 内容目录的路径（相对于 Hugo 路径）",
    filteredHeaders: "过滤的标题",
    filteredHeadersDesc: "输入要从 Hugo 内容中过滤的标题（每行一个）",
    staticPath: "静态文件路径",
    staticPathDesc: "Hugo 静态文件目录的路径（相对于 Hugo 路径）",
    imageSubPath: "图片子路径",
    imageSubPathDesc: "静态文件路径中的图片子目录（例如：'images'）",
    obsidianAttachmentInfo: "Obsidian 附件设置",
    imageSearchInfo: "图片将在您指定的目录中搜索",
    imageSearchPaths: "图片搜索目录",
    imageSearchPathsDesc: "输入要搜索图片的目录（每行一个）",
  },
  notices: {
    syncSuccess: "已同步 {0} 个文件到 Hugo",
    syncError: "同步到 Hugo 时出错：{0}",
    noFilesSelected: "没有选择要同步的文件",
    syncResult: "同步完成。总计: {0}, 成功: {1}, 失败: {2}",
    syncErrors: "同步过程中发生错误",
    imageSyncSuccess: "已为 {1} 同步 {0} 张图片",
    imageSyncError: "同步图片 {0} 失败：{1}",
  },
};

export const languages: Record<string, LanguageStrings> = { en, zh };
