import { App, Plugin, PluginSettingTab, Setting, TFile, Notice, TAbstractFile } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import { languages, LanguageStrings } from './lang';

interface HugoSyncSettings {
  hugoPath: string;
  contentPath: string;
  filteredHeaders: string[];
  language: string;
  staticPath: string;
  imageSubPath: string;
  imageSearchPaths: string[];
}

const DEFAULT_SETTINGS: HugoSyncSettings = {
  hugoPath: '',
  contentPath: 'content/posts',
  filteredHeaders: [],
  language: 'en',
  staticPath: 'static',
  imageSubPath: 'images',
  imageSearchPaths: ['assets', 'images', 'attachments', 'media', 'files']
}

export default class HugoSyncPlugin extends Plugin {
  settings: HugoSyncSettings;
  lang: LanguageStrings;

  async onload() {
    await this.loadSettings();
    this.lang = languages[this.settings.language] || languages.en;

    try {
      // Change the icon to 'refresh-cw'
      this.addRibbonIcon('refresh-cw', 'Sync to Hugo', (evt: MouseEvent) => {
        this.syncSelectedToHugo();
      });
    } catch (error) {
      console.error('Failed to add ribbon icon:', error);
    }

    this.addCommand({
      id: 'sync-selected-to-hugo',
      name: 'Sync selected file(s) to Hugo',
      callback: () => this.syncSelectedToHugo(),
    });

    this.addSettingTab(new HugoSyncSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.lang = languages[this.settings.language] || languages.en;
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.lang = languages[this.settings.language] || languages.en;
  }

  async syncSelectedToHugo() {
    const selectedFiles = this.getSelectedFiles();
    if (selectedFiles.length === 0) {
      new Notice(this.lang.notices.noFilesSelected);
      return;
    }

    let successCount = 0;
    let failCount = 0;
    let totalImageCount = 0;
    let errorMessages = [];

    for (const file of selectedFiles) {
      try {
        const syncResult = await this.syncFileToHugo(file);
        successCount++;
        totalImageCount += syncResult.imageCount;

        // 添加图片错误到主错误列表
        if (syncResult.imageErrors.length > 0) {
          errorMessages.push(...syncResult.imageErrors.map(err => `${file.name} (图片): ${err}`));
        }
      } catch (error) {
        failCount++;
        errorMessages.push(`${file.name}: ${error.message}`);
        console.error(`Error syncing file ${file.name}:`, error);
      }
    }

    // 创建详细的结果消息
    let resultMessage = this.lang.notices.syncResult
      .replace('{0}', selectedFiles.length.toString())
      .replace('{1}', successCount.toString())
      .replace('{2}', failCount.toString());

    // 添加图片统计信息
    if (totalImageCount > 0) {
      resultMessage += `\n📸 同步图片: ${totalImageCount} 张`;
    }

    if (failCount > 0 || errorMessages.length > 0) {
      resultMessage += '\n\n' + this.lang.notices.syncErrors + ':\n' + errorMessages.join('\n');
    }

    // 显示结果通知
    new Notice(resultMessage, 10000);  // 显示10秒

    // 如果有错误，在控制台输出详细信息
    if (failCount > 0) {
      console.error('Sync errors:', errorMessages);
    }
  }

  getSelectedFiles(): TFile[] {
    const selectedFiles: TFile[] = [];
    
    // 获取文浏览器中选中的文件
    const fileExplorer = this.app.workspace.getLeavesOfType('file-explorer')[0];
    if (fileExplorer && fileExplorer.view) {
      // @ts-ignore
      const selectedItems = fileExplorer.view.fileItems;
      if (selectedItems) {
        for (const item of Object.values(selectedItems)) {
          // @ts-ignore
          if (item && item.file instanceof TFile && item.titleEl && item.titleEl.classList && item.titleEl.classList.contains('is-selected')) {
            selectedFiles.push(item.file);
          }
        }
      }
    }

    // 如果文件浏览器中没有选中文件，则使用当前活动文件
    if (selectedFiles.length === 0) {
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile) {
        selectedFiles.push(activeFile);
      }
    }

    return selectedFiles;
  }

  async syncFileToHugo(file: TFile): Promise<{imageCount: number, imageErrors: string[]}> {
    const content = await this.app.vault.read(file);

    // 首先处理图片链接和复制图片文件
    const imageProcessResult = await this.processImages(content, file.name);

    const hugoContent = this.convertToHugoFormat(imageProcessResult.content, file.name);

    const hugoDirPath = path.join(this.settings.hugoPath, this.settings.contentPath);
    const hugoFilePath = path.join(hugoDirPath, file.name);

    // 确保目录存在
    if (!fs.existsSync(hugoDirPath)) {
      fs.mkdirSync(hugoDirPath, { recursive: true });
    }

    fs.writeFileSync(hugoFilePath, hugoContent);

    // 如果有图片同步成功，显示通知
    if (imageProcessResult.imageCount > 0) {
      new Notice(this.lang.notices.imageSyncSuccess
        .replace('{0}', imageProcessResult.imageCount.toString())
        .replace('{1}', file.name));
    }

    // 如果有图片同步错误，输出到控制台
    if (imageProcessResult.errors.length > 0) {
      console.error(`Image sync errors for ${file.name}:`, imageProcessResult.errors);
    }

    return {
      imageCount: imageProcessResult.imageCount,
      imageErrors: imageProcessResult.errors
    };
  }

  convertToHugoFormat(content: string, fileName: string): string {
    // 检测是否存在 YAML 前置元数据
    const hasExistingYaml = content.startsWith('---') &&
                           content.indexOf('---', 3) > 3;

    if (hasExistingYaml) {
      return this.adjustExistingYaml(content, fileName);
    } else {
      return this.createNewYaml(content, fileName);
    }
  }

  adjustExistingYaml(content: string, fileName: string): string {
    const title = fileName.replace('.md', '');
    const date = new Date().toISOString();
    const tags: string[] = [];

    // 提取现有 YAML 块（不包含结尾的 ---）
    const firstYamlEnd = content.indexOf('---', 3);
    const existingYaml = content.substring(0, firstYamlEnd);
    const contentAfterYaml = content.substring(firstYamlEnd).trim();

    // 解析现有 YAML 中的标签
    const lines = existingYaml.split('\n');
    let inTagsSection = false;

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (trimmedLine === 'tags:') {
        inTagsSection = true;
        continue;
      }

      if (inTagsSection) {
        if (trimmedLine.startsWith('-')) {
          const tag = trimmedLine.slice(1).trim().replace(/['"]/g, '');
          if (tag && !tags.includes(tag)) {
            tags.push(tag);
          }
        } else if (trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
          // 处理数组格式 tags: ["tag1", "tag2"]
          const tagArray = trimmedLine.slice(1, -1).split(',');
          for (const tag of tagArray) {
            const cleanTag = tag.trim().replace(/['"]/g, '');
            if (cleanTag && !tags.includes(cleanTag)) {
              tags.push(cleanTag);
            }
          }
        } else if (trimmedLine && !trimmedLine.startsWith(' ') && !trimmedLine.startsWith('\t')) {
          // 遇到新的字段，结束标签解析
          inTagsSection = false;
        }
      }
    }

    // 处理内容中的内联标签和标题过滤
    const processedContent = this.processContentWithTagsAndFiltering(contentAfterYaml, tags);

    // 解析现有 YAML，添加缺失字段
    const adjustedYaml = this.adjustYamlFields(existingYaml, title, date, tags);

    return adjustedYaml + '\n\n' + processedContent.join('\n').trim();
  }

  createNewYaml(content: string, fileName: string): string {
    const title = fileName.replace('.md', '');
    const date = new Date().toISOString();
    const tags: string[] = [];

    const processedContent = this.processContentWithTagsAndFiltering(content, tags);

    // 创建 Hugo 格式的前置元数据
    const hugoFrontMatter = `---
title: "${title}"
date: ${date}
draft: false
tags: [${tags.map(tag => `"${tag}"`).join(', ')}]
---

`;

    return hugoFrontMatter + processedContent.join('\n').trim();
  }

  processContentWithTagsAndFiltering(content: string, tags: string[]): string[] {
    const lines = content.split('\n');
    let tagSection = false;
    let processedContent = [];
    let currentHeaderLevel = 0;
    let skipContent = false;

    const symbolOnlyRegex = /^[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]+$/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith('#')) {
        const headerMatch = trimmedLine.match(/^(#+)\s*(.*)/);
        if (headerMatch) {
          const headerLevel = headerMatch[1].length;
          const headerContent = headerMatch[2];

          if (headerLevel <= currentHeaderLevel) {
            skipContent = false;
          }

          if (this.settings.filteredHeaders.includes(headerContent)) {
            skipContent = true;
            currentHeaderLevel = headerLevel;
            continue;
          }

          currentHeaderLevel = headerLevel;
        }
      }

      if (trimmedLine === 'tags:') {
        tagSection = true;
        continue;
      }

      if (tagSection) {
        if (trimmedLine.startsWith('-')) {
          const tag = trimmedLine.slice(1).trim();
          if (tag && !symbolOnlyRegex.test(tag) && !tags.includes(tag)) {
            tags.push(tag);
          }
        } else {
          tagSection = false;
        }
      } else if (!skipContent) {
        // 处理内联标签
        const standaloneTagsMatch = trimmedLine.match(/#[^\s#]+/g);
        if (standaloneTagsMatch) {
          standaloneTagsMatch.forEach(tag => {
            const cleanTag = tag.slice(1); // Remove the '#'
            if (!symbolOnlyRegex.test(cleanTag) && !tags.includes(cleanTag)) {
              tags.push(cleanTag);
            }
          });
          // 移除内联标签
          const cleanedLine = line.replace(/#[^\s#]+/g, '').trim();
          if (cleanedLine) {
            processedContent.push(cleanedLine);
          }
        } else {
          processedContent.push(line); // Keep original indentation
        }
      }
    }

    return processedContent;
  }

  adjustYamlFields(existingYaml: string, title: string, date: string, tags: string[]): string {
    const lines = existingYaml.split('\n');
    const result: string[] = [];
    let hasTitle = false;
    let hasDate = false;
    let hasDraft = false;
    let hasTags = false;

    // 解析现有字段（跳过开头的 ---）
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // 跳过开头的 ---
      if (trimmedLine === '---' && i === 0) {
        result.push(line);
        continue;
      }

      if (trimmedLine.startsWith('title:')) {
        hasTitle = true;
        result.push(line);
      } else if (trimmedLine.startsWith('date:')) {
        hasDate = true;
        result.push(line);
      } else if (trimmedLine.startsWith('draft:')) {
        hasDraft = true;
        result.push(line);
      } else if (trimmedLine.startsWith('tags:')) {
        hasTags = true;
        // 处理现有标签并合并新标签
        result.push(this.mergeTagsLine(line, tags));
        i = lines.length - 1; // 跳过原有标签的其他行
      } else if (trimmedLine.startsWith('-')) {
        // 跳过原有标签的其他行
        if (hasTags) continue;
        result.push(line);
      } else {
        result.push(line);
      }
    }

    // 添加缺失的字段
    if (!hasTitle) result.push(`title: "${title}"`);
    if (!hasDate) result.push(`date: ${date}`);
    if (!hasDraft) result.push('draft: false');
    if (!hasTags) result.push(`tags: [${tags.map(tag => `"${tag}"`).join(', ')}]`);

    // 添加结尾的 ---
    result.push('---');

    return result.join('\n');
  }

  mergeTagsLine(existingTagsLine: string, newTags: string[]): string {
    // 解析现有标签
    const existingTags: string[] = [];
    const trimmedLine = existingTagsLine.trim();

    if (trimmedLine === 'tags:') {
      // 格式: tags:，需要读取后续行
      return `tags: [${newTags.map(tag => `"${tag}"`).join(', ')}]`;
    } else if (trimmedLine.startsWith('tags: [') && trimmedLine.endsWith(']')) {
      // 格式: tags: ["tag1", "tag2"]
      const tagContent = trimmedLine.slice(7, -1);
      const tagArray = tagContent.split(',');
      for (const tag of tagArray) {
        const cleanTag = tag.trim().replace(/['"]/g, '');
        if (cleanTag && !existingTags.includes(cleanTag)) {
          existingTags.push(cleanTag);
        }
      }
    }

    // 合并新旧标签
    const allTags = [...new Set([...existingTags, ...newTags])];
    return `tags: [${allTags.map(tag => `"${tag}"`).join(', ')}]`;
  }

  // 处理图片链接和复制图片文件
  async processImages(content: string, fileName: string): Promise<{content: string, imageCount: number, errors: string[]}> {
    // 匹配 Obsidian 格式的图片链接: ![[图片名]]
    const imageRegex = /!\[\[([^\]]+)\]\]/g;
    const matches = [...content.matchAll(imageRegex)];
    let resultContent = content;
    let imageCount = 0;
    const errors: string[] = [];

    for (const match of matches) {
      const fullMatch = match[0];
      const imageName = match[1];

      try {
        const newImagePath = await this.copyImageToHugo(imageName, fileName);
        const newImageLink = `![${imageName}](${newImagePath})`;
        resultContent = resultContent.replace(fullMatch, newImageLink);
        imageCount++;
      } catch (error) {
        const errorMsg = `${imageName}: ${error.message}`;
        errors.push(errorMsg);
        console.warn(`Failed to copy image ${imageName}:`, error);
        // 保持原格式
      }
    }

    return { content: resultContent, imageCount, errors };
  }

  // 复制图片文件到 Hugo static 目录
  async copyImageToHugo(imageName: string, markdownFileName: string): Promise<string> {
    // 获取文章名（去掉.md扩展名）
    const articleName = markdownFileName.replace('.md', '');

    // 构建 Hugo 图片目录路径
    const hugoImageDir = path.join(
      this.settings.hugoPath,
      this.settings.staticPath,
      this.settings.imageSubPath,
      articleName
    );

    // 确保目录存在
    if (!fs.existsSync(hugoImageDir)) {
      fs.mkdirSync(hugoImageDir, { recursive: true });
    }

    // 在 Obsidian 库中查找图片文件
    const imageFile = await this.findImageFile(imageName);
    if (!imageFile) {
      throw new Error(`Image file not found: ${imageName}`);
    }

    // 构建目标路径
    const targetImagePath = path.join(hugoImageDir, imageFile.name);

    // 获取源文件的完整路径 - 使用 Obsidian 的方法
    const sourceImagePath = this.app.vault.adapter.getFullPath(imageFile.path);

    // 复制文件
    fs.copyFileSync(sourceImagePath, targetImagePath);

    // 返回相对路径（用于 Hugo 中的引用）
    // 只对文件名中的空格进行 URL 编码，文件夹名保持原样
    const encodedImageName = encodeURIComponent(imageFile.name);
    const relativePath = `../../${this.settings.imageSubPath}/${articleName}/${encodedImageName}`;
    console.log(`Generated image path: ${relativePath}`);
    return relativePath;
  }

  // 在 Obsidian 库中查找图片文件
  async findImageFile(imageName: string): Promise<TFile | null> {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp'];

    // 检查 imageName 是否包含扩展名
    const hasExtension = imageExtensions.some(ext => imageName.toLowerCase().endsWith(ext));
    const searchName = hasExtension ? imageName : imageName + '.jpg'; // 默认扩展名
    const baseName = hasExtension ? imageName.substring(0, imageName.lastIndexOf('.')) : imageName;

    console.log(`=== Image Search Start ===`);
    console.log(`Image name: ${imageName}`);
    console.log(`Has extension: ${hasExtension}`);
    console.log(`Search name: ${searchName}`);
    console.log(`Base name: ${baseName}`);

    const searchPaths = this.generateSearchPaths(searchName, baseName);
    console.log(`Search paths:`, searchPaths);

    // 按优先级搜索图片
    for (const searchPath of searchPaths) {
      console.log(`Trying path: ${searchPath}`);
      const file = this.app.vault.getAbstractFileByPath(searchPath);
      if (file instanceof TFile && imageExtensions.includes(file.extension.toLowerCase())) {
        console.log(`✅ Found image at: ${searchPath}`);
        return file;
      } else if (file) {
        console.log(`Found file but not image: ${file.path} (${file.extension})`);
      }
    }

    // 如果特定路径找不到，进行全局模糊搜索
    console.log(`Starting global search through ${this.app.vault.getFiles().length} files...`);
    const allFiles = this.app.vault.getFiles();
    let checkedFiles = 0;

    for (const file of allFiles) {
      checkedFiles++;
      // 多种匹配方式：精确文件名、基础名、包含关系
      const exactMatch = file.name === searchName || file.name === imageName;
      const baseNameMatch = file.basename === baseName;
      const containsMatch = file.name.includes(baseName) && file.name.includes(imageName.replace(/\s+/g, ''));
      const fuzzyMatch = file.name.toLowerCase().includes(baseName.toLowerCase()) ||
                         file.name.toLowerCase().includes(imageName.toLowerCase().replace(/\s+/g, ''));

      if ((exactMatch || baseNameMatch || containsMatch || fuzzyMatch) &&
          imageExtensions.includes(file.extension.toLowerCase())) {
        console.log(`✅ Found image via global search: ${file.path}`);
        console.log(`Checked ${checkedFiles} files out of ${allFiles.length}`);
        return file;
      }

      // 每检查100个文件输出一次进度
      if (checkedFiles % 100 === 0) {
        console.log(`Checked ${checkedFiles} files...`);
      }
    }

    console.log(`Checked all ${checkedFiles} files, no match found.`);

    // 最后尝试：专门处理Obsidian粘贴图片格式
    const pastedImageMatch = await this.findPastedImage(imageName, allFiles, imageExtensions);
    if (pastedImageMatch) {
      return pastedImageMatch;
    }

    console.warn(`Image not found: ${imageName}`);
    return null;
  }

  // 专门处理Obsidian粘贴图片的查找
  async findPastedImage(imageName: string, allFiles: TFile[], imageExtensions: string[]): Promise<TFile | null> {
    console.log(`Starting pasted image search...`);

    // Obsidian粘贴图片的常见格式："Pasted image YYYYMMDDHHMMSS.png"
    const pastedImagePattern = /Pasted image \d{14}\.(png|jpg|jpeg|gif|bmp|svg|webp)/i;

    // 如果当前图片名符合粘贴图片格式
    if (pastedImagePattern.test(imageName)) {
      console.log(`Image matches pasted image pattern, searching for exact match...`);
      for (const file of allFiles) {
        // 精确匹配粘贴图片格式
        if (pastedImagePattern.test(file.name) && file.name === imageName) {
          console.log(`✅ Found exact pasted image: ${file.path}`);
          return file;
        }
      }
      console.log(`No exact pasted image match found.`);
    }

    // 尝试查找任何包含"Pasted image"的文件
    console.log(`Searching for any file containing "Pasted image"...`);
    let pastedImageCount = 0;
    for (const file of allFiles) {
      if (file.name.includes("Pasted image") && imageExtensions.includes(file.extension.toLowerCase())) {
        pastedImageCount++;
        console.log(`Found potential pasted image #${pastedImageCount}: ${file.path}`);
        // 返回第一个找到的粘贴图片
        console.log(`✅ Using pasted image: ${file.path}`);
        return file;
      }
    }

    console.log(`Found ${pastedImageCount} pasted images total, but none matched.`);
    return null;
  }

  // 生成搜索路径列表
  generateSearchPaths(searchName: string, baseName: string): string[] {
    const paths: string[] = [];

    // 使用用户配置的搜索路径
    for (const dir of this.settings.imageSearchPaths) {
      paths.push(
        `${dir}/${searchName}`,
        `${dir}/${baseName}.jpg`,
        `${dir}/${baseName}.png`,
        `${dir}/${baseName}.jpeg`,
        `${dir}/${baseName}.gif`,
        `${dir}/${baseName}.svg`,
        `${dir}/${baseName}.webp`
      );
    }

    // 根目录（兜底）
    paths.push(searchName);

    return paths;
  }
}

class HugoSyncSettingTab extends PluginSettingTab {
  plugin: HugoSyncPlugin;

  constructor(app: App, plugin: HugoSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const {containerEl} = this;
    containerEl.empty();
    containerEl.createEl('h2', {text: this.plugin.lang.settings.pluginName});

    new Setting(containerEl)
      .setName(this.plugin.lang.settings.hugoPath)
      .setDesc(this.plugin.lang.settings.hugoPathDesc)
      .addText(text => text
        .setPlaceholder('Enter path')
        .setValue(this.plugin.settings.hugoPath)
        .onChange(async (value) => {
          this.plugin.settings.hugoPath = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName(this.plugin.lang.settings.contentPath)
      .setDesc(this.plugin.lang.settings.contentPathDesc)
      .addText(text => text
        .setPlaceholder('content/posts')
        .setValue(this.plugin.settings.contentPath)
        .onChange(async (value) => {
          this.plugin.settings.contentPath = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName(this.plugin.lang.settings.filteredHeaders)
      .setDesc(this.plugin.lang.settings.filteredHeadersDesc)
      .addTextArea(text => text
        .setPlaceholder('Enter headers here\nOne per line')
        .setValue(this.plugin.settings.filteredHeaders.join('\n'))
        .onChange(async (value) => {
          this.plugin.settings.filteredHeaders = value.split('\n').map(s => s.trim()).filter(s => s);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(this.plugin.lang.settings.staticPath)
      .setDesc(this.plugin.lang.settings.staticPathDesc)
      .addText(text => text
        .setPlaceholder('static')
        .setValue(this.plugin.settings.staticPath)
        .onChange(async (value) => {
          this.plugin.settings.staticPath = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(this.plugin.lang.settings.imageSubPath)
      .setDesc(this.plugin.lang.settings.imageSubPathDesc)
      .addText(text => text
        .setPlaceholder('images')
        .setValue(this.plugin.settings.imageSubPath)
        .onChange(async (value) => {
          this.plugin.settings.imageSubPath = value;
          await this.plugin.saveSettings();
        }));

    // 添加图片搜索路径设置
    const searchPathsDesc = document.createDocumentFragment();
    searchPathsDesc.createEl('div', { text: this.plugin.lang.settings.imageSearchPathsDesc });
    searchPathsDesc.createEl('br');
    searchPathsDesc.createEl('small', {
      text: 'Example: assets, images, attachments, media, files',
      cls: 'text-muted'
    });

    new Setting(containerEl)
      .setName(this.plugin.lang.settings.imageSearchPaths)
      .setDesc(searchPathsDesc)
      .addTextArea(text => text
        .setPlaceholder('assets\nimages\nattachments\nmedia\nfiles')
        .setValue(this.plugin.settings.imageSearchPaths.join('\n'))
        .onChange(async (value) => {
          this.plugin.settings.imageSearchPaths = value.split('\n').map(s => s.trim()).filter(s => s);
          await this.plugin.saveSettings();
        }));

    // 添加图片搜索信息
    const searchInfo = document.createDocumentFragment();
    searchInfo.createEl('div', { text: this.plugin.lang.settings.imageSearchInfo });
    searchInfo.createEl('br');
    searchInfo.createEl('small', {
      text: 'Check console (F12) for detailed image search logs',
      cls: 'text-muted'
    });

    new Setting(containerEl)
      .setName('Debug Information')
      .setDesc(searchInfo);

    new Setting(containerEl)
      .setName('Language')
      .setDesc('Select plugin language')
      .addDropdown(dropdown => dropdown
        .addOptions({ 'en': 'English', 'zh': '中文' })
        .setValue(this.plugin.settings.language)
        .onChange(async (value) => {
          this.plugin.settings.language = value;
          await this.plugin.saveSettings();
          this.display(); // 重新加载设置页面以应用新语言
        }));
  }
}