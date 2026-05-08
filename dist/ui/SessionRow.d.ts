import React from 'react';
import type { SessionWithMeta } from '../types.js';
interface RowProps {
    session: SessionWithMeta;
    home: string;
    focused: boolean;
    renaming: boolean;
    renameBuffer: string;
    now: number;
    /** 已合并好的标题（manual 优先 > derived） */
    title: string;
    hasManualTitle: boolean;
    /** 处于批量 kill 模式时，是否被勾选 */
    batchSelected?: boolean;
    /** 是否在批量模式（影响行首是否显示复选框） */
    batchMode?: boolean;
}
export declare const SessionRow: React.FC<RowProps>;
export {};
