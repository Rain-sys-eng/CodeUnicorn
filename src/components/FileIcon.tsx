import { memo, useMemo } from 'react';
import { getFileIcon, getFolderIcon } from '../utils/fileIcons';

export type FileIconProps = {
  filePath?: string;
  fileName?: string;
  isFolder?: boolean;
  isOpen?: boolean;
  size?: number;
  className?: string;
};

/**
 * Get file name from path
 */
function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || '';
}

/**
 * Get file icon SVG from file path
 */
function getFileIconSvg(filePath: string, isFolder?: boolean, isOpen?: boolean): string {
  const name = getFileName(filePath);

  if (isFolder) {
    return getFolderIcon(name, isOpen);
  }

  // Remove line number suffix if present (e.g., "file.ts:10-20")
  const cleanName = name.replace(/:\d+(-\d+)?$/, '');
  const extension = cleanName.indexOf('.') !== -1 ? cleanName.split('.').pop() : '';
  return getFileIcon(extension, cleanName);
}

/**
 * File icon component that safely renders SVG icons.
 *
 * Security note: The SVG content comes from internal trusted source (getFileIconSvg)
 * which maps file extensions to pre-defined SVG strings. No user input is rendered.
 */
export const FileIcon = memo(
  ({
    filePath,
    fileName,
    isFolder,
    isOpen,
    size,
    className,
  }: FileIconProps) => {
    const usesLegacyFileNameContract =
      (!filePath || !filePath.trim()) && typeof fileName === 'string';
    const resolvedPath =
      typeof filePath === 'string' && filePath.trim()
        ? filePath
        : (fileName ?? '');
    const resolvedIsFolder =
      isFolder ?? (typeof fileName === 'string' ? fileName.endsWith('/') : false);
    const resolvedClassName = usesLegacyFileNameContract
      ? ['file-icon', className].filter(Boolean).join(' ')
      : (className ?? 'file-icon');
    const dimension = size ?? (usesLegacyFileNameContract ? 14 : 16);
    const svgContent = useMemo(
      () => getFileIconSvg(resolvedPath, resolvedIsFolder, isOpen),
      [resolvedIsFolder, resolvedPath, isOpen]
    );

    return (
      <span
        className={resolvedClassName}
        style={{
          display: 'inline-flex',
          width: dimension,
          height: dimension,
          flexShrink: 0,
          overflow: 'hidden',
        }}
        dangerouslySetInnerHTML={{ __html: svgContent }}
        aria-hidden="true"
      />
    );
  }
);

FileIcon.displayName = 'FileIcon';

export { getFileIconSvg, getFileName };
