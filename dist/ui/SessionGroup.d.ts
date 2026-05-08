import React from 'react';
import type { SessionGroup as Group } from '../utils/groups.js';
interface GroupProps {
    group: Group;
    home: string;
    focused: boolean;
    /** -1 表示该 group 未聚焦 */
    focusedRowIndex: number;
    renaming: boolean;
    renameBuffer: string;
    now: number;
    resolveTitle: (cwd: string, fallback: string) => {
        title: string;
        manual: boolean;
    };
    batchMode?: boolean;
    selectedPids?: Set<number>;
}
export declare const SessionGroup: React.FC<GroupProps>;
export {};
