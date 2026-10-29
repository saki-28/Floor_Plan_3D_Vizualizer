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
    <div className="w-full h-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden rounded-xl border border-slate-800">
      {/* Top Banner */}
      <div className="bg-slate-900 border-b border-slate-800 p-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold text-slate-200">
            C++ & OpenGL Project Repository Explorer (Windows VS Code / CMake)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="px-2.5 py-1 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md border border-slate-700 flex items-center gap-1.5 transition"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy Code'}
          </button>
          <button
            onClick={handleDownloadFile}
            className="px-2.5 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-md flex items-center gap-1.5 transition shadow"
          >
            <Download className="w-3.5 h-3.5" /> Download File
          </button>
        </div>
      </div>

      {/* Main Split View */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left: File Tree */}
        <div className="w-full md:w-64 bg-slate-900/80 border-r border-slate-800 p-3 overflow-y-auto flex flex-col gap-1">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
            <FolderTree className="w-3.5 h-3.5 text-blue-400" /> FloorPlan3D /
          </div>

          {CPP_PROJECT_FILES.map((file) => {
            const isSelected = file.path === selectedFile.path;
            return (
              <button
                key={file.path}
                onClick={() => setSelectedFile(file)}
                className={`text-left px-2.5 py-1.5 rounded-md text-xs font-mono transition flex items-center justify-between ${
                  isSelected
                    ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40 font-semibold'
                    : 'text-slate-300 hover:bg-slate-800/60'
                }`}
              >
                <span className="truncate">{file.path}</span>
                <span
                  className={`text-[9px] px-1 py-0.2 rounded uppercase ${
                    file.category === 'shader'
                      ? 'bg-purple-900/50 text-purple-300'
                      : file.category === 'header'
                      ? 'bg-amber-900/50 text-amber-300'
                      : file.category === 'build'
                      ? 'bg-emerald-900/50 text-emerald-300'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {file.category}
                </span>
              </button>
            );
          })}
        </div>

        {/* Right: Code Viewer */}
        <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
          {/* File Header Details */}
          <div className="bg-slate-900/50 border-b border-slate-800 px-4 py-2 flex items-center justify-between">
            <div>
              <span className="font-mono text-xs font-semibold text-slate-200">
                {selectedFile.path}
              </span>
              <p className="text-[11px] text-slate-400">{selectedFile.description}</p>
            </div>
          </div>

          {/* Syntax highlighted code with line numbers */}
          <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-200 bg-slate-950">
            <pre className="whitespace-pre">
              {selectedFile.code.split('\n').map((line, idx) => (
                <div key={idx} className="table-row">
                  <span className="table-cell pr-4 text-right select-none text-slate-600 w-10">
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
