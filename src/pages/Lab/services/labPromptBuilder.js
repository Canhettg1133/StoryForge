/**
 * StoryForge - Lab Prompt Builder (Standalone)
 * 
 * Cloned from the core prompt builder to allow isolated experimentation.
 * Includes all narrative layers (Grand Strategy, Author DNA, Style DNA, etc.)
 */

import { TASK_TYPES } from '../../../services/ai/router';
import {
    PRONOUN_PRESETS,
    GENRE_PRONOUN_MAP,
    AUTHOR_ROLE_TABLE,
    MOOD_BOARD_DEFAULTS,
    detectWritingStyle,
    NSFW_AUTHOR_DNA,
    NSFW_RELATION_MATRIX,
    NSFW_STYLE_EUPHEMISMS,
    NSFW_CHRONO_STRUCTURE
} from '../../../utils/constants';

// =============================================
// Layer 1: System Identity
// =============================================
const LAYER_1_IDENTITY = [
    'Ban la dong bien tap vien truyen chu chuyen nghiep trong ung dung StoryForge.',
    'Ban luon uu tien tinh nhat quan (consistency), giong van rieng cua tac pham, va tuan theo moi quy tac the gioi truyen.',
    'Ban viet bang tieng Viet tru khi duoc yeu cau khac.',
    'Ban KHONG tu y them phan giai thich, ghi chu, hay meta-commentary - chi tra ve ket qua yeu cau.',
    'Ban PHAI tuan thu tuyet doi moi cam ky (taboo) duoc liet ke.',
].join('\n');

// Writing tasks for Lab (Conversational)
const WRITING_TASKS_FOR_BRIDGE = new Set([
    TASK_TYPES.CONTINUE,
    TASK_TYPES.EXPAND,
    TASK_TYPES.REWRITE,
    TASK_TYPES.SCENE_DRAFT,
    TASK_TYPES.ARC_CHAPTER_DRAFT,
    TASK_TYPES.FREE_PROMPT,
]);

const FULL_WRITING_TASKS = new Set([
    TASK_TYPES.CONTINUE,
    TASK_TYPES.SCENE_DRAFT,
    TASK_TYPES.ARC_CHAPTER_DRAFT,
    TASK_TYPES.FREE_PROMPT, // RE-ENABLED for Lab to ensure full soul injection
]);

const STYLE_ONLY_TASKS = new Set([
    TASK_TYPES.EXPAND,
    TASK_TYPES.REWRITE,
]);

// Task Instructions (Cloned)
export const TASK_INSTRUCTIONS = {
    [TASK_TYPES.CONTINUE]: 'Viet tiep doan van, giu nguyen giong van va nhip ke. Hay mieu ta that chi tiet tung hanh dong, tam ly, canh vat, doi thoai. Viet DAI va CHI TIET, muc tieu 2000-4000 tu de dong gop vao muc tieu chuong truyen 7000 tu. KHONG viet ngan, KHONG luoc bo, KHONG tom tat.',
    [TASK_TYPES.REWRITE]: 'Viet lai doan van, cai thien van phong nhung giu nguyen noi dung va y nghia. Lam cho no tu nhien hon, giau cam xuc hon. Muc tieu tra ve tu 5000-7000 tu.',
    [TASK_TYPES.EXPAND]: 'Mo rong doan van, them chi tiet mieu ta, cam xuc, doi thoai, va hanh dong. Giu nguyen giong van. Viet CUC KY CHI TIET va DAI, muc tieu cot loi doan van duoc mo rong ra phai dai 7000 tu. Mieu ta dao sau vao tam ly nhan vat, boi canh, va tung hanh dong nho.',
    [TASK_TYPES.BRAINSTORM]: 'Brainstorm y tuong sang tao, dua ra nhieu huong khac nhau.',
    [TASK_TYPES.OUTLINE]: 'Tao outline cau truc ro rang, logic.',
    [TASK_TYPES.PLOT_SUGGEST]: 'Goi y 3 huong plot co the xay ra tiep theo. Moi huong gom: tom tat, xung dot, va dieu gi se thay doi.',
    [TASK_TYPES.SUMMARIZE]: 'Tom tat noi dung trong khoang 150-200 tu, giu cac su kien chinh, thay doi quan trong, va trang thai nhan vat.',
    [TASK_TYPES.EXTRACT_TERMS]: 'Trich xuat: 1) Ten nhan vat (va vai tro), 2) Dia danh, 3) Vat pham quan trong, 4) Thuat ngu the gioi truyen. Tra ve dang danh sach.',
    [TASK_TYPES.SCENE_DRAFT]: 'Viet ban nhap canh nay, cuc ky chi tiet va dai dong, mo ta dao sau vao tung cu chi tam ly. Viet khoang 1500-2500 tu/lan sinh de dong gop vao muc tieu chuong truyen tong cong 7000 tu.',
    [TASK_TYPES.FREE_PROMPT]: 'Thuc hien yeu cau cua tac gia. Neu duoc yeu cau viet noi dung truyen, hay viet CUC KY CHI TIET va DAI: mieu ta hanh dong, tam ly, doi thoai, canh vat. Muc tieu toi thieu 5000-7000 tu khi viet noi dung chuong. KHONG tom tat, KHONG luoc bo, KHONG viet ngan.',
};

function buildGrandStrategyLayer(taskType, currentMacroArc, currentArc, ultimateGoal, targetLength, currentChapterIndex) {
    if (!WRITING_TASKS_FOR_BRIDGE.has(taskType)) return '';
    if (!currentMacroArc && !currentArc) return '';
    const parts = [];
    if (currentMacroArc) {
        const macroLines = [];
        macroLines.push('Cot moc lon hien tai: ' + currentMacroArc.title);
        if (currentMacroArc.description) macroLines.push('Mo ta: ' + currentMacroArc.description);
        parts.push('[COT MOC LON]\n' + macroLines.join('\n'));
    }
    if (currentArc) {
        const arcLines = [];
        arcLines.push('Hoi truyen hien tai: ' + (currentArc.title || '(chua dat ten)'));
        if (currentArc.goal) arcLines.push('Muc tieu hoi nay: ' + currentArc.goal);
        parts.push('[HOI TRUYEN HIEN TAI]\n' + arcLines.join('\n'));
    }
    return '[CHIEN LUOC TONG THE - DAI CUC]\n' + parts.join('\n\n');
}

function buildAuthorDNALayer(taskType, writingStyle, chapterIndex, targetLength) {
    const isFullWriting = FULL_WRITING_TASKS.has(taskType);
    const isStyleOnly = STYLE_ONLY_TASKS.has(taskType);
    if (!isFullWriting && !isStyleOnly) return '';
    const roles = AUTHOR_ROLE_TABLE[writingStyle] || AUTHOR_ROLE_TABLE['thuan_viet'];
    const role = roles[1] || 'Tac gia gieu kinh nghiem';
    const lines = [];
    lines.push('[LINH HON TAC GIA]');
    lines.push('VAI TRO CUA BAN: Ban la ' + role + '.');
    lines.push('TRIET LY VIET (BAT BUOC INTERNALIZE):');
    lines.push('1. Viet bang cam xuc, khong phai thong tin.');
    lines.push('2. Moi canh PHAI thay doi trang thai nhan vat.');
    lines.push('3. Doc gia CAM truoc, HIEU sau.');
    return lines.join('\n');
}

function buildStyleDNALayer(taskType, writingStyle) {
    if (!WRITING_TASKS_FOR_BRIDGE.has(taskType)) return '';
    if (writingStyle === 'han_viet') {
        return '[VAN PHONG DNA - HAN VIET] (Cloned style rules...)';
    }
    return '[VAN PHONG DNA - THUAN VIET] (Cloned style rules...)';
}

export function buildPrompt(taskType, context = {}) {
    const {
        userPrompt,
        genre,
        writingStyle,
        nsfwMode,
        superNsfwMode,
        // Add other context pieces as needed
    } = context;

    const genreKey = genre ? genre.toLowerCase().replace(/\s+/g, '_') : '';
    const resolvedWritingStyle = writingStyle || detectWritingStyle(genreKey || '');
    const systemParts = [];

    // Layer 0: Grand Strategy
    const gsLayer = buildGrandStrategyLayer(taskType, context.currentMacroArc, context.currentArc, context.ultimateGoal, context.targetLength, context.currentChapterIndex);
    if (gsLayer) systemParts.push(gsLayer);

    // Layer 0.5: Author DNA
    const authorLayer = buildAuthorDNALayer(taskType, resolvedWritingStyle, context.currentChapterIndex, context.targetLength);
    if (authorLayer) systemParts.push(authorLayer);

    // Layer 1: System Identity
    systemParts.push(LAYER_1_IDENTITY);

    // Layer 2: Task Instruction
    const taskInstr = TASK_INSTRUCTIONS[taskType] || 'Thuc hien nhiem vu.';
    systemParts.push('\n[NHIEM VU]\n' + taskInstr);

    // Layer 8: NSFW OVERRIDE
    if (nsfwMode) systemParts.push('\n' + NSFW_AUTHOR_DNA);
    if (nsfwMode && !superNsfwMode) {
        systemParts.push('\n' + NSFW_RELATION_MATRIX);
        systemParts.push('\n' + NSFW_STYLE_EUPHEMISMS);
    }

    // Final System Prompt
    const systemPrompt = systemParts.join('\n\n');

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt || 'Bat dau viet.' }
    ];
}
