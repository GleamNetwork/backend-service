import { describe, expect, it } from 'vitest';
import { hashPassword, sha256, verifyPassword } from '../../src/security';
import { AIService } from '../../src/services/ai.service';
import { CaseService } from '../../src/services/case.service';
import { errors } from '../../src/errors';

describe('security utilities', () => {
  it('hashes and verifies passwords without storing plaintext', () => {
    const stored = hashPassword('TongpinDemo2026!');
    expect(stored).not.toContain('TongpinDemo2026!');
    expect(stored.startsWith('scrypt:')).toBe(true);
    expect(verifyPassword('TongpinDemo2026!', stored)).toBe(true);
    expect(verifyPassword('wrong-password', stored)).toBe(false);
  });

  it('creates stable SHA-256 request hashes', () => {
    expect(sha256('abc')).toHaveLength(64);
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).not.toBe(sha256('abd'));
  });
});

describe('AI safety check', () => {
  const service = Object.create(AIService.prototype) as AIService;

  it('blocks diagnosis, medication, absolute secrecy, and external action', () => {
    expect(service.checkSafety('你可能患有抑郁症').passed).toBe(false);
    expect(service.checkSafety('建议你服用药物').passed).toBe(false);
    expect(service.checkSafety('我不会告诉任何人，绝对保密').passed).toBe(false);
    expect(service.checkSafety('我会替你拨打120').passed).toBe(false);
  });

  it('allows non-judgmental listening suggestions', () => {
    const result = service.checkSafety('谢谢你愿意说出来。你希望我先听你说，还是先帮你确认接下来想获得的支持？');
    expect(result.passed).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});

describe('case mapping and errors', () => {
  it('maps MySQL JSON fields and preserves state version', () => {
    const service = Object.create(CaseService.prototype) as CaseService;
    const mapped = service.mapCase({
      id: 'case_1',
      user_id: 'user_1',
      district_id: 'district_1',
      support_need_level: 'attention',
      service_progress: 'in_progress',
      response_path: 'R3',
      status: 'in_progress',
      assigned_volunteer_id: 'volunteer_1',
      owner_type: 'staff',
      owner_id: 'volunteer_1',
      consent_scope: JSON.stringify(['chat_text']),
      request_type: 'volunteer_text',
      preferred_contact: 'text',
      created_at: new Date(),
      updated_at: new Date(),
      closed_at: null,
      version: 2,
    });
    expect(mapped.consent_scope).toEqual(['chat_text']);
    expect(mapped.version).toBe(2);
    expect(mapped.status).toBe('in_progress');
  });

  it('creates typed application errors', () => {
    const error = errors.capacityExceeded('同时陪伴已满');
    expect(error.status).toBe(422);
    expect(error.code).toBe('CAPACITY_EXCEEDED');
    expect(error.message).toBe('同时陪伴已满');
  });
});
