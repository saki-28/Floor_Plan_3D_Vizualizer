import { Button, PageHeader } from './ui';
import React, { useState } from 'react';
import { CPP_PROJECT_FILES, CppFile } from '../data/cppProjectFiles';
import {
  FolderTree,
  FileCode,
  Copy,
  Check,
  Download,
  Terminal,
  Settings,
  ShieldCheck,
} from 'lucide-react';

export const CppRepoExplorer: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<CppFile>(CPP_PROJECT_FILES[0]);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(selectedFile.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadFile = () => {
    const blob = new Blob([selectedFile.code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selectedFile.path.split('/').pop() || 'file.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-full flex-col gap-5 lg:h-full">
      <PageHeader
        title="C++ reference"
        description="The original C++ and OpenGL desktop code, kept for reference. It has never been compiled; the product is now the web app."
        actions={
          <>
            <Button onClick={handleCopy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" strokeWidth={1.5} />}
              {copied ? 'Copied' : 'Copy file'}
            </Button>
            <Button variant="primary" onClick={handleDownloadFile}>
              <Download className="h-4 w-4" strokeWidth={1.5} /> Download file
            </Button>
          </>
        }
      />

      {/* Main Split View */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line md:flex-row">
        {/* Left: File Tree */}
        <div className="w-full md:w-64 bg-raised border-r border-line p-3 overflow-y-auto flex flex-col gap-1">
          <div className="text-xs font-bold text-muted   mb-2 flex items-center gap-1">
            <FolderTree className="w-3.5 h-3.5 text-accent" /> FloorPlan3D /
          </div>

          {CPP_PROJECT_FILES.map((file) => {
            const isSelected = file.path === selectedFile.path;
            return (
              <button
                key={file.path}
                onClick={() => setSelectedFile(file)}
                className={`text-left px-2.5 py-1.5 rounded-md text-xs num transition flex items-center justify-between ${
                  isSelected
                    ? 'bg-accent-soft text-accent border border-line font-semibold'
                    : 'text-ink hover:bg-active'
                }`}
              >
                <span className="truncate">{file.path}</span>
                <span
                  className={`text-xs px-1 py-0.2 rounded  ${
                    file.category === 'shader'
                      ? 'bg-accent-soft text-accent'
                      : file.category === 'header'
                      ? 'bg-warning-soft text-ink'
                      : file.category === 'build'
                      ? 'bg-positive-soft text-positive'
                      : 'bg-active text-muted'
                  }`}
                >
                  {file.category}
                </span>
              </button>
            );
          })}
        </div>

        {/* Right: Code Viewer */}
        <div className="flex-1 flex flex-col bg-surface overflow-hidden">
          {/* File Header Details */}
          <div className="bg-raised border-b border-line px-4 py-2 flex items-center justify-between">
            <div>
              <span className="num text-xs font-semibold text-ink">
                {selectedFile.path}
              </span>
              <p className="text-[13px] text-muted">{selectedFile.description}</p>
            </div>
          </div>

          {/* Syntax highlighted code with line numbers */}
          <div className="flex-1 overflow-auto p-4 num text-[13px] leading-relaxed text-ink bg-surface">
            <pre className="whitespace-pre">
              {selectedFile.code.split('\n').map((line, idx) => (
                <div key={idx} className="table-row">
                  <span className="table-cell pr-4 text-right select-none text-muted w-10">
                    {idx + 1}
                  </span>
                  <span className="table-cell">{line}</span>
                </div>
              ))}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
