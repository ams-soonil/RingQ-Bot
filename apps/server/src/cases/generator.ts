import { TestCaseSchema, type FlowStep, type TestCase } from '@ringq/shared';
import type { FigmaExtract } from '../figma/client.js';
import type { CaseLLM } from '../llm/types.js';

export interface CaseGenerator {
  generate(runId: string, extract: FigmaExtract): Promise<TestCase[]>;
}

const VALID_ACTIONS = new Set(['navigate', 'click', 'expect']);

function knownTargets(extract: FigmaExtract): Set<string> {
  const set = new Set<string>();
  for (const f of extract.frames) {
    set.add(f.name);
    set.add(f.nodeId);
    for (const el of f.elements) set.add(el.name);
  }
  return set;
}

export function createCaseGenerator(llm: CaseLLM): CaseGenerator {
  return {
    async generate(runId, extract) {
      const drafts = await llm.proposeCases(extract);
      const known = knownTargets(extract);
      const cases: TestCase[] = [];
      let idx = 0;
      const nextId = () => `tc_${runId}_${idx++}`;
      const coveredUiNodes = new Set<string>();

      for (const d of drafts) {
        if (d.type === 'ui') {
          // figmaNodeId가 없거나 알려진 프레임과 매칭되지 않으면 스킵
          // (미매칭 초안은 per-frame 기본 루프가 커버하므로 중복/노드없는 케이스 방지)
          const frame = d.figmaNodeId
            ? extract.frames.find((f) => f.nodeId === d.figmaNodeId)
            : undefined;
          if (!frame) continue;
          cases.push(
            TestCaseSchema.parse({
              id: nextId(),
              runId,
              type: 'ui',
              source: 'figma',
              status: 'draft',
              title: d.title,
              figmaNodeId: d.figmaNodeId,
              uiExpectation: {
                texts: d.texts ?? frame.texts,
                elements: d.elements ?? frame.elements.map((e) => e.name),
                colors: frame.colors,
              },
            }),
          );
          coveredUiNodes.add(d.figmaNodeId!);
        } else {
          const steps: FlowStep[] = (d.steps ?? [])
            .filter((s) => VALID_ACTIONS.has(s.action) && known.has(s.target))
            .map((s) => ({ action: s.action as FlowStep['action'], target: s.target, note: s.note }));
          // 환각 방지: 원래 step 수와 살아남은 step 수가 다르면(미매칭 target 존재) 버린다.
          const originalCount = (d.steps ?? []).length;
          if (steps.length === 0 || steps.length !== originalCount) continue;
          cases.push(
            TestCaseSchema.parse({
              id: nextId(),
              runId,
              type: 'flow',
              source: 'figma',
              status: 'draft',
              title: d.title,
              steps,
            }),
          );
        }
      }

      // UI 케이스 보장: 누락 프레임에 기본 UI 케이스 추가
      for (const frame of extract.frames) {
        if (coveredUiNodes.has(frame.nodeId)) continue;
        cases.push(
          TestCaseSchema.parse({
            id: nextId(),
            runId,
            type: 'ui',
            source: 'figma',
            status: 'draft',
            title: `${frame.name} 화면 UI`,
            figmaNodeId: frame.nodeId,
            uiExpectation: {
              texts: frame.texts,
              elements: frame.elements.map((e) => e.name),
              colors: frame.colors,
            },
          }),
        );
      }

      return cases;
    },
  };
}
