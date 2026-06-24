export interface FigmaElement {
  type: string;
  name: string;
  text?: string;
}
export interface FigmaFrame {
  nodeId: string;
  name: string;
  texts: string[];
  elements: FigmaElement[];
  colors: string[];
  imageUrl?: string;
}
export interface FigmaTransition {
  fromNodeId: string;
  toNodeId: string;
  trigger: string;
}
export interface FigmaExtract {
  fileKey: string;
  frames: FigmaFrame[];
  transitions: FigmaTransition[];
}

export interface FigmaClient {
  fetchExtract(url: string): Promise<FigmaExtract>;
}

const ELEMENT_TYPES = new Set(['INSTANCE', 'COMPONENT']);
const ELEMENT_NAME_HINT = /(버튼|button|입력|input|field|체크|toggle|링크|link|아이콘|icon)/i;

export function parseFigmaUrl(url: string): { fileKey: string; nodeIds: string[] } {
  const m = url.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
  if (!m) throw new Error(`Figma URL 형식이 아님: ${url}`);
  const fileKey = m[1];
  const u = new URL(url);
  const raw = u.searchParams.get('node-id');
  const nodeIds = raw ? [raw.replace(/-/g, ':')] : [];
  return { fileKey, nodeIds };
}

function rgbToHex(c: { r: number; g: number; b: number }): string {
  const h = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

interface RawNode {
  id: string;
  name: string;
  type: string;
  characters?: string;
  fills?: { type: string; color?: { r: number; g: number; b: number } }[];
  children?: RawNode[];
  interactions?: { trigger?: { type?: string }; actions?: { destinationId?: string }[] }[];
  transitionNodeID?: string;
}

const SCREEN_CONTAINER_TYPES = new Set(['CANVAS', 'SECTION']);
const SCREEN_FRAME_TYPES = new Set(['FRAME', 'COMPONENT', 'INSTANCE']);

/**
 * 주어진 루트 노드를 "화면 프레임" 단위로 분리한다.
 * - CANVAS/SECTION(페이지·섹션)이면 직속 자식 중 내용 있는 프레임들을 각각 한 화면으로.
 *   (설계서 페이지를 통째로 주면 18개 화면이 1개로 뭉개지는 것을 방지)
 * - 그 외(단일 화면 프레임 등)는 루트 자체를 한 화면으로.
 */
function collectScreenFrames(root: RawNode): RawNode[] {
  if (SCREEN_CONTAINER_TYPES.has(root.type)) {
    const screens = (root.children ?? []).filter(
      (c) => SCREEN_FRAME_TYPES.has(c.type) && (c.children?.length ?? 0) > 0,
    );
    if (screens.length > 0) return screens;
  }
  return [root];
}

function walk(
  node: RawNode,
  frame: FigmaFrame,
  transitions: FigmaTransition[],
): void {
  if (node.type === 'TEXT' && node.characters) {
    frame.texts.push(node.characters);
  }
  for (const fill of node.fills ?? []) {
    if (fill.type === 'SOLID' && fill.color) {
      const hex = rgbToHex(fill.color);
      if (!frame.colors.includes(hex)) frame.colors.push(hex);
    }
  }
  if (ELEMENT_TYPES.has(node.type) || ELEMENT_NAME_HINT.test(node.name)) {
    frame.elements.push({ type: node.type, name: node.name, text: node.characters });
  }
  for (const inter of node.interactions ?? []) {
    const dest = inter.actions?.find((a) => a.destinationId)?.destinationId;
    if (dest) {
      transitions.push({ fromNodeId: node.id, toNodeId: dest, trigger: inter.trigger?.type ?? 'ON_CLICK' });
    }
  }
  if (node.transitionNodeID) {
    transitions.push({ fromNodeId: node.id, toNodeId: node.transitionNodeID, trigger: 'ON_CLICK' });
  }
  for (const child of node.children ?? []) walk(child, frame, transitions);
}

export function createFigmaClient(opts: { token: string; fetchImpl?: typeof fetch }): FigmaClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const headers = { 'X-Figma-Token': opts.token };

  return {
    async fetchExtract(url) {
      const { fileKey, nodeIds } = parseFigmaUrl(url);
      const ids = nodeIds.join(',');

      const nodesRes = await doFetch(
        `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${ids}&depth=6`,
        { headers },
      );
      if (!nodesRes.ok) {
        throw new Error(`figma API ${nodesRes.status}: ${await nodesRes.text()}`);
      }
      const nodesBody = (await nodesRes.json()) as {
        nodes: Record<string, { document: RawNode }>;
      };

      // 반환된 루트 노드들을 화면 프레임 단위로 분리(페이지 → 화면별).
      const screenNodes: RawNode[] = [];
      for (const entry of Object.values(nodesBody.nodes)) {
        screenNodes.push(...collectScreenFrames(entry.document));
      }

      // 화면 프레임별 렌더 이미지(비전 비교용)를 그 노드 id들로 한 번에 조회.
      let images: Record<string, string> = {};
      const screenIds = screenNodes.map((n) => n.id);
      if (screenIds.length) {
        const imgRes = await doFetch(
          `https://api.figma.com/v1/images/${fileKey}?ids=${screenIds.join(',')}&format=png&scale=2`,
          { headers },
        );
        if (imgRes.ok) {
          images = ((await imgRes.json()) as { images: Record<string, string> }).images ?? {};
        }
      }

      const frames: FigmaFrame[] = [];
      const transitions: FigmaTransition[] = [];
      for (const node of screenNodes) {
        const frame: FigmaFrame = {
          nodeId: node.id,
          name: node.name,
          texts: [],
          elements: [],
          colors: [],
          imageUrl: images[node.id],
        };
        walk(node, frame, transitions);
        frames.push(frame);
      }

      return { fileKey, frames, transitions };
    },
  };
}
