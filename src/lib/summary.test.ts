import { describe, expect, it } from 'vitest'
import { summarizeWork } from './summary'

describe('summarizeWork', () => {
  it('turns daily notes into three editable fields', () => {
    expect(summarizeWork('完成首页设计。跟进插画交付。明天做适配。')).toEqual({
      completed: '完成首页设计。',
      progress: '跟进插画交付。',
      tomorrow: '明天做适配。',
    })
  })

  it('provides gentle defaults for short input', () => {
    const result = summarizeWork('整理了需求')
    expect(result.completed).toBe('整理了需求。')
    expect(result.progress).toContain('推进')
  })
})

