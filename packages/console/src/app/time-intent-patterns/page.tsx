"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface PatternEntry {
  projectId: string;
  projectName: string;
  projectColor: string | null;
  startTime: string;
  sortOrder: number;
  memo: string | null;
}

interface PatternGroup {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PatternVersion {
  versionNumber: string;
  contentHash: string;
  validFrom: string;
  validTo: string | null;
  entryCount: number;
  message: string | null;
}

interface PatternInfo {
  group: PatternGroup;
  currentVersion: PatternVersion | null;
  entries: PatternEntry[];
}

interface ProjectInfo {
  projectId: string;
  projectName: string;
  projectColor: string | null;
}

export default function PatternsPage() {
  const router = useRouter();
  const [patterns, setPatterns] = useState<PatternInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit mode state - which group is being edited
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingEntries, setEditingEntries] = useState<PatternEntry[]>([]);
  const [newVersionNumber, setNewVersionNumber] = useState("");
  const [newVersionMessage, setNewVersionMessage] = useState("");
  const [savingVersion, setSavingVersion] = useState(false);

  // New pattern modal
  const [showNewPatternModal, setShowNewPatternModal] = useState(false);
  const [newPatternName, setNewPatternName] = useState("");
  const [creatingPattern, setCreatingPattern] = useState(false);

  // Validation error
  const [validationError, setValidationError] = useState<string | null>(null);

  // Project picker popover
  const [openProjectPicker, setOpenProjectPicker] = useState<number | null>(null);

  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Delete confirmation state
  const [deleteConfirmGroupId, setDeleteConfirmGroupId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Expanded pattern state (which patterns are expanded to show entries)
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());

  // Calendar registration state
  const [registerGroupId, setRegisterGroupId] = useState<string | null>(null);
  const [registerDate, setRegisterDate] = useState<string>("");
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    fetchPatterns();
  }, []);

  async function fetchPatterns() {
    try {
      setLoading(true);
      const res = await fetch("/api/time-intent-patterns?includeProjects=true");
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        throw new Error("Failed to fetch patterns");
      }
      const data = await res.json();
      setPatterns(Array.isArray(data.patterns) ? data.patterns : []);
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function startEditing(pattern: PatternInfo) {
    setEditingGroupId(pattern.group.id);
    setEditingName(pattern.group.name);
    // Sort entries by sortOrder for editing (UI order = sortOrder)
    const sortedEntries = [...pattern.entries].sort((a, b) => a.sortOrder - b.sortOrder);
    setEditingEntries(sortedEntries);
    setValidationError(null);
    setNewVersionMessage("");
    // Auto-expand when editing
    setExpandedGroupIds(prev => new Set(prev).add(pattern.group.id));
    // Suggest next version number
    const currentVersion = pattern.currentVersion?.versionNumber || "v0.0.0";
    const match = currentVersion.match(/v(\d+)\.(\d+)\.(\d+)/);
    if (match) {
      const [, major, minor, patch] = match;
      setNewVersionNumber(`v${major}.${minor}.${parseInt(patch) + 1}`);
    } else {
      setNewVersionNumber("v0.1.0");
    }
  }

  function toggleExpanded(groupId: string) {
    setExpandedGroupIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  }

  function cancelEditing() {
    setEditingGroupId(null);
    setEditingEntries([]);
    setNewVersionNumber("");
    setNewVersionMessage("");
    setValidationError(null);
    setOpenProjectPicker(null);
  }

  // Validate that UI order matches startTime order
  function validateEntriesOrder(entries: PatternEntry[]): { valid: boolean; error?: string } {
    if (entries.length <= 1) return { valid: true };

    // Check startTime ordering
    for (let i = 0; i < entries.length - 1; i++) {
      const current = entries[i].startTime;
      const next = entries[i + 1].startTime;
      if (current >= next) {
        return {
          valid: false,
          error: `時刻順が正しくありません: ${i + 1}行目 (${current.slice(0, 5)}) は ${i + 2}行目 (${next.slice(0, 5)}) より前である必要があります`,
        };
      }
    }

    return { valid: true };
  }

  async function handleUpdateName(groupId: string) {
    if (!editingName.trim()) return;

    try {
      const res = await fetch(`/api/time-intent-patterns/${groupId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingName.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update name");
      }

      await fetchPatterns();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update name");
    }
  }

  async function handleCreatePattern() {
    if (!newPatternName.trim()) return;

    try {
      setCreatingPattern(true);
      const res = await fetch("/api/time-intent-patterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newPatternName.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create pattern");
      }

      setShowNewPatternModal(false);
      setNewPatternName("");
      await fetchPatterns();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create pattern");
    } finally {
      setCreatingPattern(false);
    }
  }

  async function handleSaveVersion() {
    if (!editingGroupId || !newVersionNumber.trim()) return;

    // Validate order before saving
    const validation = validateEntriesOrder(editingEntries);
    if (!validation.valid) {
      setValidationError(validation.error || "時刻順が正しくありません");
      return;
    }

    // Clear any previous validation error
    setValidationError(null);

    // Assign sortOrder based on UI position (0-indexed) and clean memo
    const entriesWithSortOrder = editingEntries.map((entry, index) => ({
      ...entry,
      sortOrder: index,
      memo: entry.memo?.replace(/`/g, "") || null,
    }));

    try {
      setSavingVersion(true);
      const res = await fetch(`/api/time-intent-patterns/${editingGroupId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionNumber: newVersionNumber.trim(),
          entries: entriesWithSortOrder,
          message: newVersionMessage.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save version");
      }

      setEditingGroupId(null);
      setNewVersionMessage("");
      setValidationError(null);
      setOpenProjectPicker(null);
      await fetchPatterns();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save version");
    } finally {
      setSavingVersion(false);
    }
  }

  function updateEntry(index: number, field: keyof PatternEntry, value: string | number | null) {
    setEditingEntries(prev => {
      const newEntries = [...prev];
      newEntries[index] = { ...newEntries[index], [field]: value };
      return newEntries;
    });
  }

  function updateEntryProject(index: number, projectId: string) {
    const project = projects.find(p => p.projectId === projectId);
    if (project) {
      setEditingEntries(prev => {
        const newEntries = [...prev];
        newEntries[index] = {
          ...newEntries[index],
          projectId: project.projectId,
          projectName: project.projectName,
          projectColor: project.projectColor,
        };
        return newEntries;
      });
    }
  }

  function addEntry() {
    // sortOrder will be assigned on save based on UI position
    setEditingEntries(prev => [...prev, {
      projectId: "",
      projectName: "",
      projectColor: null,
      startTime: "09:00:00",
      sortOrder: 0, // Will be reassigned on save
      memo: null,
    }]);
  }

  function removeEntry(index: number) {
    setEditingEntries(prev => prev.filter((_, i) => i !== index));
  }

  // Drag and drop handlers
  function handleDragStart(index: number) {
    setDraggedIndex(index);
    setOpenProjectPicker(null);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  }

  function handleDragLeave() {
    setDragOverIndex(null);
  }

  function handleDrop(index: number) {
    if (draggedIndex !== null && draggedIndex !== index) {
      setEditingEntries(prev => {
        const newEntries = [...prev];
        const [removed] = newEntries.splice(draggedIndex, 1);
        newEntries.splice(index, 0, removed);
        return newEntries;
      });
      setValidationError(null);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  }

  function handleDragEnd() {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }

  // Sort entries by startTime
  function sortByTime() {
    setEditingEntries(prev => {
      const sorted = [...prev].sort((a, b) => a.startTime.localeCompare(b.startTime));
      return sorted;
    });
    setValidationError(null);
  }

  // Normalize time input: 1202->12:02, 12:02->12:02, １２：０２->12:02, 12:02:30->12:02
  function normalizeTimeInput(input: string): string | null {
    // Convert full-width to half-width
    const halfWidth = input
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[：]/g, ":")
      .replace(/\s/g, "");

    // Try various patterns
    // Pattern 0: HH:MM:SS (ignore seconds)
    let match = halfWidth.match(/^(\d{1,2}):(\d{2}):\d{2}$/);
    if (match) {
      const h = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
      }
    }

    // Pattern 1: HH:MM or H:MM
    match = halfWidth.match(/^(\d{1,2}):(\d{2})$/);
    if (match) {
      const h = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
      }
    }

    // Pattern 2: HHMM (4 digits)
    match = halfWidth.match(/^(\d{4})$/);
    if (match) {
      const h = parseInt(halfWidth.slice(0, 2), 10);
      const m = parseInt(halfWidth.slice(2, 4), 10);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
      }
    }

    // Pattern 3: HMM (3 digits, e.g., 930 -> 09:30)
    match = halfWidth.match(/^(\d{3})$/);
    if (match) {
      const h = parseInt(halfWidth.slice(0, 1), 10);
      const m = parseInt(halfWidth.slice(1, 3), 10);
      if (h >= 0 && h <= 9 && m >= 0 && m <= 59) {
        return `0${h}:${m.toString().padStart(2, "0")}`;
      }
    }

    // Pattern 4: HH or H (just hours)
    match = halfWidth.match(/^(\d{1,2})$/);
    if (match) {
      const h = parseInt(match[1], 10);
      if (h >= 0 && h <= 23) {
        return `${h.toString().padStart(2, "0")}:00`;
      }
    }

    return null; // Invalid
  }

  // Delete pattern group
  async function handleDeletePattern(groupId: string) {
    try {
      setDeleting(true);
      const res = await fetch(`/api/time-intent-patterns/${groupId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete pattern");
      }

      setDeleteConfirmGroupId(null);
      setEditingGroupId(null);
      await fetchPatterns();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete pattern");
    } finally {
      setDeleting(false);
    }
  }

  // Open calendar registration popup
  function openRegisterPopup(groupId: string) {
    setRegisterGroupId(groupId);
    // Default to today
    const today = new Date().toISOString().slice(0, 10);
    setRegisterDate(today);
  }

  // Register pattern to Google Calendar
  async function handleRegisterToCalendar() {
    if (!registerGroupId || !registerDate) return;

    try {
      setRegistering(true);
      const res = await fetch(`/api/time-intent-patterns/${registerGroupId}/register-calendar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: registerDate }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to register events");
      }

      // Show success message
      alert(`${data.created}件のイベントを登録しました。${data.failed > 0 ? `\n${data.failed}件失敗しました。` : ""}`);
      setRegisterGroupId(null);
      setRegisterDate("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to register events");
    } finally {
      setRegistering(false);
    }
  }

  function formatTime(time: string): string {
    return time.slice(0, 5);
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function calculateDuration(startTime: string, nextStartTime: string | null): string | null {
    if (!nextStartTime) return null;

    const [startH, startM] = startTime.split(":").map(Number);
    const [nextH, nextM] = nextStartTime.split(":").map(Number);

    const startMinutes = startH * 60 + startM;
    const nextMinutes = nextH * 60 + nextM;

    const diffMinutes = nextMinutes - startMinutes;
    if (diffMinutes <= 0) return null;

    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;

    if (hours > 0 && minutes > 0) {
      return `${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h`;
    } else {
      return `${minutes}m`;
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center">
        <p className="text-zinc-500">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="max-w-5xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <a
              href="/"
              className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              ← 戻る
            </a>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Time Intent Patterns
            </h1>
          </div>
          <button
            onClick={() => setShowNewPatternModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium transition-colors"
          >
            + 新規パターン
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {patterns.length === 0 ? (
          <div className="bg-white dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 p-8 text-center">
            <p className="text-zinc-500 dark:text-zinc-400 mb-4">
              パターンがありません。
            </p>
            <button
              onClick={() => setShowNewPatternModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium transition-colors"
            >
              最初のパターンを作成
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {patterns.map((pattern) => {
              const isEditing = editingGroupId === pattern.group.id;
              const isExpanded = expandedGroupIds.has(pattern.group.id) || isEditing;
              // In edit mode, use editingEntries directly (already sorted, UI order is source of truth)
              // In view mode, sort by sortOrder
              const displayEntries = isEditing
                ? editingEntries
                : [...(Array.isArray(pattern.entries) ? pattern.entries : [])].sort((a, b) => a.sortOrder - b.sortOrder);

              return (
                <div
                  key={pattern.group.id}
                  className={`bg-white dark:bg-zinc-950 rounded-lg border ${
                    isEditing
                      ? "border-blue-500 dark:border-blue-500 min-h-[400px]"
                      : "border-zinc-200 dark:border-zinc-800 overflow-hidden"
                  }`}
                >
                  {/* Header */}
                  <div
                    className={`p-4 ${isExpanded ? "border-b border-zinc-200 dark:border-zinc-800" : ""} ${!isEditing ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50" : ""}`}
                    onClick={() => !isEditing && toggleExpanded(pattern.group.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-3">
                          {isEditing ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onBlur={() => handleUpdateName(pattern.group.id)}
                                className="text-lg font-medium bg-transparent border-0 border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 focus:outline-none text-zinc-900 dark:text-zinc-100 p-0"
                              />
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                              <button
                                onClick={() => setDeleteConfirmGroupId(pattern.group.id)}
                                className="ml-2 px-2 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 rounded transition-colors"
                              >
                                削除
                              </button>
                            </div>
                          ) : (
                            <>
                              {/* Chevron icon */}
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className={`text-zinc-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                              >
                                <polyline points="9 18 15 12 9 6" />
                              </svg>
                              <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
                                {pattern.group.name}
                              </h2>
                              <button
                                onClick={(e) => { e.stopPropagation(); startEditing(pattern); }}
                                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                                title="編集"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                              </button>
                            </>
                          )}
                        </div>
                        {/* Version, date and message below pattern name */}
                        {!isEditing && pattern.currentVersion && (
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
                              {pattern.currentVersion.versionNumber}
                            </span>
                            <span className="text-xs text-zinc-400 dark:text-zinc-500">
                              {formatDate(pattern.currentVersion.validFrom)}
                            </span>
                            {pattern.currentVersion.message && (
                              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                {pattern.currentVersion.message}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm flex-shrink-0">
                        {isEditing ? (
                          <>
                            <input
                              type="text"
                              value={newVersionNumber}
                              onChange={(e) => setNewVersionNumber(e.target.value)}
                              placeholder="v0.1.0"
                              className="font-mono text-zinc-900 dark:text-zinc-100 bg-transparent border-0 border-b border-zinc-300 dark:border-zinc-600 focus:border-blue-500 focus:outline-none w-16"
                            />
                            <input
                              type="text"
                              value={newVersionMessage}
                              onChange={(e) => setNewVersionMessage(e.target.value)}
                              placeholder="変更内容..."
                              className="text-zinc-900 dark:text-zinc-100 bg-transparent border-0 border-b border-zinc-300 dark:border-zinc-600 focus:border-blue-500 focus:outline-none w-32"
                            />
                            <button
                              onClick={cancelEditing}
                              className="px-2 py-1 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 whitespace-nowrap"
                            >
                              キャンセル
                            </button>
                            <button
                              onClick={handleSaveVersion}
                              disabled={savingVersion || !newVersionNumber.trim()}
                              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded font-medium transition-colors whitespace-nowrap"
                            >
                              {savingVersion ? "..." : "保存"}
                            </button>
                          </>
                        ) : (
                          <>
                            {!pattern.currentVersion && (
                              <span className="text-zinc-400 dark:text-zinc-500">バージョンなし</span>
                            )}
                            {pattern.currentVersion && pattern.entries.length > 0 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); openRegisterPopup(pattern.group.id); }}
                                className="px-3 py-1.5 bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50 text-green-700 dark:text-green-300 rounded transition-colors"
                                title="Google Calendar に登録"
                              >
                                登録
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); startEditing(pattern); }}
                              className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded transition-colors"
                            >
                              編集
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Validation Error */}
                  {isEditing && validationError && (
                    <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
                      <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        {validationError}
                      </p>
                    </div>
                  )}

                  {/* Pattern Entries Table - only show when expanded */}
                  {isExpanded && (
                    <div className={isEditing ? "" : "overflow-x-auto"}>
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-100 dark:bg-zinc-800">
                        <tr>
                          <th className="px-4 py-2 text-left text-zinc-600 dark:text-zinc-300 font-medium w-24">
                            <div className="flex items-center gap-2">
                              時刻
                              {isEditing && (
                                <button
                                  onClick={sortByTime}
                                  className="text-blue-600 hover:text-blue-700 p-0.5"
                                  title="時刻順にソート"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M3 6h18" />
                                    <path d="M7 12h10" />
                                    <path d="M10 18h4" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </th>
                          <th className="px-4 py-2 text-left text-zinc-600 dark:text-zinc-300 font-medium">
                            プロジェクト
                          </th>
                          <th className="px-4 py-2 text-left text-zinc-600 dark:text-zinc-300 font-medium w-24">
                            所要時間
                          </th>
                          <th className="px-4 py-2 text-left text-zinc-600 dark:text-zinc-300 font-medium">
                            メモ
                          </th>
                          {isEditing && (
                            <th className="px-4 py-2 text-right text-zinc-600 dark:text-zinc-300 font-medium w-20">
                              <button
                                onClick={addEntry}
                                className="text-blue-600 hover:text-blue-700 text-xs"
                              >
                                + 追加
                              </button>
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {displayEntries.map((entry, idx) => {
                          const nextEntry = displayEntries[idx + 1];
                          const duration = calculateDuration(
                            entry.startTime,
                            nextEntry?.startTime || null
                          );

                          if (isEditing) {
                            // In edit mode, idx is the actual index (UI order is source of truth)
                            // Style to match view mode as closely as possible
                            const isPickerOpen = openProjectPicker === idx;
                            const isDragging = draggedIndex === idx;
                            const isDragOver = dragOverIndex === idx;

                            return (
                              <tr
                                key={idx}
                                draggable
                                onDragStart={() => handleDragStart(idx)}
                                onDragOver={(e) => handleDragOver(e, idx)}
                                onDragLeave={handleDragLeave}
                                onDrop={() => handleDrop(idx)}
                                onDragEnd={handleDragEnd}
                                className={`border-t border-zinc-200 dark:border-zinc-800 group transition-all ${
                                  isDragging ? "opacity-50 bg-zinc-100 dark:bg-zinc-800" : ""
                                } ${isDragOver ? "border-t-2 border-t-blue-500" : ""}`}
                              >
                                <td className="px-4 py-2">
                                  <div className="flex items-center gap-2">
                                    {/* Drag handle */}
                                    <span
                                      className="cursor-grab active:cursor-grabbing text-zinc-300 dark:text-zinc-600 hover:text-zinc-500 dark:hover:text-zinc-400"
                                      title="ドラッグして並び替え"
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                        <circle cx="9" cy="6" r="1.5" />
                                        <circle cx="15" cy="6" r="1.5" />
                                        <circle cx="9" cy="12" r="1.5" />
                                        <circle cx="15" cy="12" r="1.5" />
                                        <circle cx="9" cy="18" r="1.5" />
                                        <circle cx="15" cy="18" r="1.5" />
                                      </svg>
                                    </span>
                                    <input
                                      type="text"
                                      value={
                                        // If stored as HH:MM:SS format, display as HH:MM
                                        // Otherwise display raw value (during editing)
                                        /^\d{2}:\d{2}:\d{2}$/.test(entry.startTime)
                                          ? entry.startTime.slice(0, 5)
                                          : entry.startTime
                                      }
                                      onChange={(e) => {
                                        // Allow free input, store raw value
                                        updateEntry(idx, "startTime", e.target.value);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          (e.target as HTMLInputElement).blur();
                                        }
                                      }}
                                      onBlur={(e) => {
                                        const val = e.target.value.trim();
                                        if (!val) {
                                          // Empty input - reset to 00:00
                                          updateEntry(idx, "startTime", "00:00:00");
                                          return;
                                        }
                                        const normalized = normalizeTimeInput(val);
                                        if (normalized) {
                                          updateEntry(idx, "startTime", `${normalized}:00`);
                                          setValidationError(null);
                                        } else {
                                          setValidationError(`無効な時刻: "${val}"`);
                                        }
                                      }}
                                      className="font-mono text-zinc-900 dark:text-zinc-100 bg-transparent border-0 border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 focus:outline-none p-0 w-14 text-center"
                                      placeholder="00:00"
                                    />
                                  </div>
                                </td>
                                <td className="px-4 py-2 relative">
                                  <button
                                    type="button"
                                    onClick={() => setOpenProjectPicker(isPickerOpen ? null : idx)}
                                    className="inline-flex items-center gap-2 px-2 py-0.5 rounded-md text-sm font-medium cursor-pointer hover:ring-2 hover:ring-blue-500/50 transition-all"
                                    style={{
                                      backgroundColor: entry.projectColor ? `${entry.projectColor}40` : "rgba(128,128,128,0.2)",
                                      color: entry.projectColor || undefined,
                                    }}
                                  >
                                    {entry.projectColor && (
                                      <span
                                        className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: entry.projectColor }}
                                      />
                                    )}
                                    {entry.projectName || "選択..."}
                                  </button>
                                  {/* Project Picker Popover */}
                                  {isPickerOpen && (
                                    <>
                                      <div
                                        className="fixed inset-0 z-40"
                                        onClick={() => setOpenProjectPicker(null)}
                                      />
                                      <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg max-h-64 overflow-y-auto min-w-48 p-1.5 flex flex-col gap-1 items-start">
                                        {projects.map(p => (
                                          <button
                                            key={p.projectId}
                                            type="button"
                                            onClick={() => {
                                              updateEntryProject(idx, p.projectId);
                                              setOpenProjectPicker(null);
                                            }}
                                            className="inline-flex items-center gap-2 px-2 py-0.5 text-left hover:ring-2 hover:ring-blue-500/50 text-sm font-medium rounded-md transition-all w-auto"
                                            style={{
                                              backgroundColor: p.projectColor ? `${p.projectColor}40` : "rgba(128,128,128,0.2)",
                                              color: p.projectColor || undefined,
                                            }}
                                          >
                                            <span
                                              className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                                              style={{ backgroundColor: p.projectColor || "#888" }}
                                            />
                                            {p.projectName}
                                          </button>
                                        ))}
                                      </div>
                                    </>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">
                                  {duration || "-"}
                                </td>
                                <td className="px-4 py-2">
                                  <input
                                    type="text"
                                    value={entry.memo?.replace(/```/g, "") || ""}
                                    onChange={(e) => updateEntry(idx, "memo", e.target.value || null)}
                                    placeholder="-"
                                    className="w-full bg-transparent border-0 border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 focus:outline-none text-zinc-900 dark:text-zinc-100 p-0 placeholder-zinc-400 dark:placeholder-zinc-500"
                                  />
                                </td>
                                <td className="px-4 py-2 text-right">
                                  <button
                                    onClick={() => removeEntry(idx)}
                                    className="text-zinc-300 dark:text-zinc-600 hover:text-red-500 dark:hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="削除"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <line x1="18" y1="6" x2="6" y2="18" />
                                      <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                  </button>
                                </td>
                              </tr>
                            );
                          }

                          // View mode
                          return (
                            <tr
                              key={idx}
                              className="border-t border-zinc-200 dark:border-zinc-800"
                            >
                              <td className="px-4 py-2 font-mono text-zinc-900 dark:text-zinc-100">
                                {formatTime(entry.startTime)}
                              </td>
                              <td className="px-4 py-2">
                                <span
                                  className="inline-flex items-center gap-2 px-2 py-0.5 rounded-md text-sm font-medium"
                                  style={{
                                    backgroundColor: entry.projectColor ? `${entry.projectColor}40` : undefined,
                                    color: entry.projectColor || undefined,
                                  }}
                                >
                                  {entry.projectColor && (
                                    <span
                                      className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                                      style={{ backgroundColor: entry.projectColor }}
                                    />
                                  )}
                                  {entry.projectName}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">
                                {duration || "-"}
                              </td>
                              <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">
                                {entry.memo?.replace(/```/g, "") || "-"}
                              </td>
                            </tr>
                          );
                        })}
                        {displayEntries.length === 0 && (
                          <tr>
                            <td colSpan={isEditing ? 5 : 4} className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-400">
                              {isEditing ? (
                                <button
                                  onClick={addEntry}
                                  className="text-blue-600 hover:text-blue-700"
                                >
                                  + エントリを追加
                                </button>
                              ) : (
                                "エントリがありません"
                              )}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Delete Confirmation Modal */}
      {deleteConfirmGroupId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 w-full max-w-sm">
            <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-4">
              パターンを削除
            </h3>
            <p className="text-zinc-600 dark:text-zinc-400 mb-6">
              すべてのバージョンを削除しますか？
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmGroupId(null)}
                className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                disabled={deleting}
              >
                キャンセル
              </button>
              <button
                onClick={() => handleDeletePattern(deleteConfirmGroupId)}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-md text-sm font-medium transition-colors"
              >
                {deleting ? "削除中..." : "削除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Pattern Modal */}
      {showNewPatternModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-4">
              新規パターン作成
            </h3>
            <input
              type="text"
              value={newPatternName}
              onChange={(e) => setNewPatternName(e.target.value)}
              placeholder="パターン名 (例: work_day_short)"
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 mb-4"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreatePattern();
              }}
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowNewPatternModal(false);
                  setNewPatternName("");
                }}
                className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                キャンセル
              </button>
              <button
                onClick={handleCreatePattern}
                disabled={creatingPattern || !newPatternName.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-md text-sm font-medium transition-colors"
              >
                {creatingPattern ? "作成中..." : "作成"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Calendar Registration Modal */}
      {registerGroupId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-4">
              Google Calendar に登録
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              パターンのエントリをGoogle Calendarのイベントとして登録します。
            </p>
            <label className="block text-sm text-zinc-700 dark:text-zinc-300 mb-2">
              登録する日付
            </label>
            <input
              type="date"
              value={registerDate}
              onChange={(e) => setRegisterDate(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setRegisterGroupId(null);
                  setRegisterDate("");
                }}
                className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                disabled={registering}
              >
                キャンセル
              </button>
              <button
                onClick={handleRegisterToCalendar}
                disabled={registering || !registerDate}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white rounded-md text-sm font-medium transition-colors"
              >
                {registering ? "登録中..." : "登録"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
