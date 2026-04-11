/**
 * StoryForge — ArcNavigator
 *
 * Thanh tiến trình Grand Strategy: hiển thị vị trí hiện tại trong đại cục 800 chương.
 * Dùng ở Sidebar hoặc bất kỳ đâu cần cho tác giả thấy "đang ở đâu trên bản đồ".
 *
 * Props:
 *   projectId        : number  — ID dự án hiện tại
 *   currentChapter   : number  — order_index chương đang mở (0-based)
 *   totalChapters    : number  — tổng số chương mục tiêu (project.target_length)
 *   compact          : bool    — hiển thị dạng thu gọn (chỉ progress bar + tên cột mốc)
 */

import React, { useEffect, useState, useMemo } from 'react';
import db from '../../services/db/database';
import { Flag, ChevronRight, TrendingUp } from 'lucide-react';
import './ArcNavigator.css';

export default function ArcNavigator({
    projectId,
    currentChapter = 0,
    totalChapters = 0,
    compact = false,
}) {
    const [macroArcs, setMacroArcs] = useState([]);

    useEffect(() => {
        if (!projectId) return;
        db.macro_arcs
            .where('project_id').equals(projectId)
            .sortBy('order_index')
            .then(setMacroArcs)
            .catch(() => setMacroArcs([]));
    }, [projectId]);

    // Chương hiện tại (1-based để so sánh với chapter_from/chapter_to)
    const currentChapterDisplay = currentChapter + 1;
    const progressPercent = totalChapters > 0
        ? Math.min(100, Math.round((currentChapterDisplay / totalChapters) * 100))
        : 0;

    // Tìm macro arc hiện tại
    const currentMacroArc = useMemo(() => {
        if (macroArcs.length === 0) return null;
        return macroArcs.find(m =>
            currentChapterDisplay >= (m.chapter_from || 0) &&
            currentChapterDisplay <= (m.chapter_to || Infinity)
        ) || macroArcs[macroArcs.length - 1];
    }, [macroArcs, currentChapterDisplay]);

    // Macro arc tiếp theo
    const nextMacroArc = useMemo(() => {
        if (!currentMacroArc || macroArcs.length === 0) return null;
        const idx = macroArcs.findIndex(m => m.id === currentMacroArc.id);
        return idx < macroArcs.length - 1 ? macroArcs[idx + 1] : null;
    }, [macroArcs, currentMacroArc]);

    if (!projectId) return null;

    // ─── Compact mode ───
    if (compact) {
        return (
            <div className="arc-nav arc-nav--compact">
                <div className="arc-nav__bar-wrap">
                    <div
                        className="arc-nav__bar-fill"
                        style={{ width: progressPercent + '%' }}
                    />
                </div>
                <span className="arc-nav__compact-label">
                    {currentMacroArc
                        ? currentMacroArc.title
                        : `Ch.${currentChapterDisplay}${totalChapters > 0 ? '/' + totalChapters : ''}`}
                </span>
            </div>
        );
    }

    // ─── Full mode ───
    return (
        <div className="arc-nav">
            {/* Header */}
            <div className="arc-nav__header">
                <TrendingUp size={14} />
                <span>Đại cục</span>
                <span className="arc-nav__progress-text">
                    Ch.{currentChapterDisplay}{totalChapters > 0 ? `/${totalChapters}` : ''} · {progressPercent}%
                </span>
                {totalChapters > 0 && currentChapterDisplay > totalChapters && (
                    <span className="arc-nav__over-target" title={`Đã vượt mục tiêu (target: ${totalChapters} chương)`}>
                        ⚠️ Vượt mục tiêu
                    </span>
                )}
            </div>

            {/* Tổng tiến trình */}
            <div className="arc-nav__bar-wrap arc-nav__bar-wrap--full">
                <div
                    className="arc-nav__bar-fill"
                    style={{ width: progressPercent + '%' }}
                />
                {/* Markers cho từng macro arc */}
                {macroArcs.map((m) => {
                    if (!m.chapter_to || totalChapters === 0) return null;
                    const markerPos = Math.min(100, Math.round((m.chapter_to / totalChapters) * 100));
                    return (
                        <div
                            key={m.id}
                            className="arc-nav__marker"
                            style={{ left: markerPos + '%' }}
                            title={m.title}
                        />
                    );
                })}
            </div>

            {/* Danh sách cột mốc */}
            {macroArcs.length > 0 && (
                <div className="arc-nav__milestones">
                    {macroArcs.map((m) => {
                        const isCurrent = currentMacroArc?.id === m.id;
                        const isDone = m.chapter_to && currentChapterDisplay > m.chapter_to;
                        return (
                            <div
                                key={m.id}
                                className={[
                                    'arc-nav__milestone',
                                    isCurrent ? 'arc-nav__milestone--current' : '',
                                    isDone ? 'arc-nav__milestone--done' : '',
                                ].filter(Boolean).join(' ')}
                            >
                                <div className="arc-nav__milestone-dot">
                                    {isDone ? '✓' : isCurrent ? '►' : '○'}
                                </div>
                                <div className="arc-nav__milestone-info">
                                    <span className="arc-nav__milestone-title">{m.title}</span>
                                    {(m.chapter_from || m.chapter_to) && (
                                        <span className="arc-nav__milestone-range">
                                            Ch.{m.chapter_from || '?'}–{m.chapter_to || '?'}
                                        </span>
                                    )}
                                    {isCurrent && m.emotional_peak && (
                                        <span className="arc-nav__milestone-emotion">{m.emotional_peak}</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Cột mốc tiếp theo */}
            {nextMacroArc && (
                <div className="arc-nav__next">
                    <ChevronRight size={12} />
                    <span>Tiếp: <strong>{nextMacroArc.title}</strong></span>
                    {nextMacroArc.chapter_from && (
                        <span className="arc-nav__next-range">Ch.{nextMacroArc.chapter_from}</span>
                    )}
                </div>
            )}

            {/* Empty state */}
            {macroArcs.length === 0 && (
                <div className="arc-nav__empty">
                    <Flag size={14} />
                    <span>Chưa có đại cục. Thêm trong Story Bible.</span>
                </div>
            )}
        </div>
    );
}