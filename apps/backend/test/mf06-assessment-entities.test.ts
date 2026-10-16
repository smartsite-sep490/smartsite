import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getMetadataArgsStorage } from 'typeorm';
import { ZoneEntryAssessmentEntity } from '../src/database/entities/zone-entry-assessment.entity.js';
import { ZoneEntryAuthorityArtifactEntity } from '../src/database/entities/zone-entry-authority-artifact.entity.js';
import { ZoneEntryAssessmentRequestEntity } from '../src/database/entities/zone-entry-assessment-request.entity.js';

// -----------------------------------------------------------------------------
// TypeORM Metadata Inspection Helpers (Pure metadata, no database connection)
// -----------------------------------------------------------------------------

const storage = getMetadataArgsStorage();
type EntityConstructor =
  | typeof ZoneEntryAssessmentEntity
  | typeof ZoneEntryAuthorityArtifactEntity
  | typeof ZoneEntryAssessmentRequestEntity;

function getEntityTable(target: EntityConstructor) {
  return storage.tables.find((t) => t.target === target);
}

function getEntityColumns(target: EntityConstructor) {
  return storage.columns.filter((c) => c.target === target);
}

function findEntityColumn(target: EntityConstructor, propOrColName: string) {
  return storage.columns.find(
    (c) =>
      c.target === target && (c.propertyName === propOrColName || c.options.name === propOrColName),
  );
}

function getEntityForeignKeys(target: EntityConstructor) {
  return storage.foreignKeys.filter((fk) => fk.target === target);
}

function getEntityUniques(target: EntityConstructor) {
  return storage.uniques.filter((u) => u.target === target);
}

function getEntityIndices(target: EntityConstructor) {
  return storage.indices.filter((i) => i.target === target);
}

function getEntityChecks(target: EntityConstructor) {
  return storage.checks.filter((chk) => chk.target === target);
}

interface ExpectedColumnSpec {
  propOrCol: string;
  dbName: string;
  type: string;
  length?: number;
  nullable: boolean;
  isPrimary?: boolean;
}

function assertColumnMatches(target: EntityConstructor, expected: ExpectedColumnSpec) {
  const col = findEntityColumn(target, expected.propOrCol);
  assert.ok(
    col,
    `Column '${expected.propOrCol}' (db: '${expected.dbName}') must be defined on ${target.name}`,
  );

  const actualDbName = col.options.name ?? col.propertyName;
  assert.equal(
    actualDbName,
    expected.dbName,
    `Column '${expected.propOrCol}' db name mismatch: expected '${expected.dbName}', got '${actualDbName}'`,
  );

  assert.equal(
    col.options.type,
    expected.type,
    `Column '${expected.propOrCol}' type mismatch: expected '${expected.type}', got '${String(col.options.type)}'`,
  );

  if (expected.length !== undefined) {
    const actualLength = col.options.length !== undefined ? Number(col.options.length) : undefined;
    assert.equal(
      actualLength,
      expected.length,
      `Column '${expected.propOrCol}' length mismatch: expected ${expected.length}, got ${actualLength}`,
    );
  }

  const isNullable = col.options.nullable === true;
  assert.equal(
    isNullable,
    expected.nullable,
    `Column '${expected.propOrCol}' nullability mismatch: expected nullable=${expected.nullable}, got ${isNullable}`,
  );

  if (expected.isPrimary) {
    const isPrimary = col.options.primary === true;
    assert.ok(
      isPrimary,
      `Column '${expected.propOrCol}' must be registered as primary key on ${target.name}`,
    );
  }
}

function assertHasUnique(
  target: EntityConstructor,
  propOrColNames: string[],
  options: { constraintName?: string } = {},
) {
  if (propOrColNames.length === 1 && propOrColNames[0] !== undefined) {
    const col = findEntityColumn(target, propOrColNames[0]);
    if (col?.options.unique === true) return;
  }

  const uniques = getEntityUniques(target);
  const found = uniques.find((u) => {
    if (options.constraintName && u.name && u.name !== options.constraintName) return false;
    const rawCols = typeof u.columns === 'function' ? (u.columns as () => unknown)() : u.columns;
    if (!Array.isArray(rawCols)) return false;
    const cols = rawCols.map(String);
    if (cols.length !== propOrColNames.length) return false;

    return propOrColNames.every((expected) =>
      cols.some((c) => {
        if (c.toLowerCase() === expected.toLowerCase()) return true;
        const normalizedC = c.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
        const normalizedExp = expected.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
        return (
          normalizedC.toLowerCase() === normalizedExp.toLowerCase() ||
          c.toLowerCase() === normalizedExp.toLowerCase()
        );
      }),
    );
  });

  assert.ok(
    found,
    `Unique constraint on ${target.name} for [${propOrColNames.join(', ')}]${options.constraintName ? ` ('${options.constraintName}')` : ''} not found`,
  );
}

function assertHasForeignKey(
  target: EntityConstructor,
  expectedTarget: EntityConstructor | string,
  expectedColumns: string[],
  expectedReferencedColumns: string[],
  options: { name?: string; onDelete?: string } = {},
) {
  const fks = getEntityForeignKeys(target);
  const match = fks.find((fk) => {
    const resolvedRef = typeof fk.type === 'function' ? (fk.type as () => unknown)() : fk.type;

    const refMatches =
      resolvedRef === expectedTarget ||
      (typeof expectedTarget === 'string' &&
        (resolvedRef === expectedTarget ||
          (resolvedRef as { name?: string })?.name === expectedTarget));

    if (!refMatches) return false;

    const sourceCols = (Array.isArray(fk.columnNames) ? fk.columnNames : [fk.columnNames]).map(
      String,
    );
    const refCols = (
      Array.isArray(fk.referencedColumnNames)
        ? fk.referencedColumnNames
        : [fk.referencedColumnNames]
    ).map(String);
    if (
      sourceCols.length !== expectedColumns.length ||
      refCols.length !== expectedReferencedColumns.length
    )
      return false;

    const colsMatch = expectedColumns.every((col) =>
      sourceCols.some((sc) => {
        if (sc.toLowerCase() === col.toLowerCase()) return true;
        const normalizedSc = sc.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
        const normalizedCol = col.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
        return normalizedSc.toLowerCase() === normalizedCol.toLowerCase();
      }),
    );

    const refColsMatch = expectedReferencedColumns.every((col) =>
      refCols.some((rc) => {
        if (rc.toLowerCase() === col.toLowerCase()) return true;
        const normalizedRc = rc.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
        const normalizedCol = col.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
        return normalizedRc.toLowerCase() === normalizedCol.toLowerCase();
      }),
    );

    if (options.name && fk.name && fk.name !== options.name) return false;

    return colsMatch && refColsMatch;
  });

  assert.ok(
    match,
    `Foreign key on ${target.name} targeting ${typeof expectedTarget === 'string' ? expectedTarget : expectedTarget.name} [${expectedColumns.join(', ')}] -> [${expectedReferencedColumns.join(', ')}] not found`,
  );

  if (options.onDelete) {
    assert.equal(
      match.onDelete,
      options.onDelete,
      `Foreign key onDelete must be '${options.onDelete}'`,
    );
  }

  if (options.name) {
    assert.equal(match.name, options.name, `Foreign key constraint name must be '${options.name}'`);
  }
}

function assertHasCheckRegex(target: EntityConstructor, pattern: RegExp, description: string) {
  const checks = getEntityChecks(target);
  const combined = checks.map((c) => c.expression).join('\n');
  assert.ok(
    pattern.test(combined),
    `Check constraint on ${target.name} matching ${pattern} (${description}) not found. Registered checks:\n${combined}`,
  );
}

// -----------------------------------------------------------------------------
// Test Suite: MF06 B2 Assessment Entities TypeORM Metadata Specification
// -----------------------------------------------------------------------------

describe('MF06 B2 Assessment Entities Metadata Tests (Tests-First Specification)', () => {
  describe('Suite 1: Architecture Boundaries & Metadata Class Registration', () => {
    it('registers exactly two separate entity classes for MF06 B2 persistence', () => {
      assert.notEqual(
        ZoneEntryAssessmentEntity,
        ZoneEntryAuthorityArtifactEntity,
        'Assessment and Artifact must be distinct entity classes',
      );
      assert.equal(
        typeof ZoneEntryAssessmentEntity,
        'function',
        'ZoneEntryAssessmentEntity must be a class constructor',
      );
      assert.equal(
        typeof ZoneEntryAuthorityArtifactEntity,
        'function',
        'ZoneEntryAuthorityArtifactEntity must be a class constructor',
      );
    });

    it('binds ZoneEntryAuthorityArtifactEntity to table mf06_authority_artifact', () => {
      const table = getEntityTable(ZoneEntryAuthorityArtifactEntity);
      assert.ok(table, 'ZoneEntryAuthorityArtifactEntity must be decorated with @Entity()');
      assert.equal(
        table.name,
        'mf06_authority_artifact',
        "Table name must match migration DDL 'mf06_authority_artifact'",
      );
    });

    it('binds ZoneEntryAssessmentEntity to table mf06_assessment', () => {
      const table = getEntityTable(ZoneEntryAssessmentEntity);
      assert.ok(table, 'ZoneEntryAssessmentEntity must be decorated with @Entity()');
      assert.equal(
        table.name,
        'mf06_assessment',
        "Table name must match migration DDL 'mf06_assessment'",
      );
    });

    it('ensures no eager relations exist on either entity to prevent large payload leakage or memory bloat', () => {
      const relations = storage.relations.filter(
        (r) =>
          r.target === ZoneEntryAssessmentEntity || r.target === ZoneEntryAuthorityArtifactEntity,
      );
      for (const rel of relations) {
        assert.notEqual(
          rel.options.eager,
          true,
          `Relation '${rel.propertyName}' on ${typeof rel.target === 'string' ? rel.target : rel.target.name} must not be eager`,
        );
      }
    });

    it('ensures no embedded entities are declared on assessment or artifact', () => {
      const embeddeds = storage.embeddeds.filter(
        (e) =>
          e.target === ZoneEntryAssessmentEntity || e.target === ZoneEntryAuthorityArtifactEntity,
      );
      assert.equal(
        embeddeds.length,
        0,
        'No embedded entities permitted on MF06 assessment or artifact',
      );
    });
  });

  describe('Suite 2: ZoneEntryAuthorityArtifactEntity TypeORM Columns & Constraints', () => {
    const expectedArtifactColumns: ExpectedColumnSpec[] = [
      {
        propOrCol: 'artifactId',
        dbName: 'artifact_id',
        type: 'uuid',
        nullable: false,
        isPrimary: true,
      },
      {
        propOrCol: 'requestId',
        dbName: 'request_id',
        type: 'uuid',
        nullable: false,
      },
      {
        propOrCol: 'sha256',
        dbName: 'sha256',
        type: 'char',
        length: 64,
        nullable: false,
      },
      {
        propOrCol: 'body',
        dbName: 'body',
        type: 'jsonb',
        nullable: false,
      },
      {
        propOrCol: 'bodyHash',
        dbName: 'body_hash',
        type: 'char',
        length: 64,
        nullable: false,
      },
      {
        propOrCol: 'storedAt',
        dbName: 'stored_at',
        type: 'timestamptz',
        nullable: false,
      },
    ];

    it('declares exactly the 6 columns matching candidate migration DDL', () => {
      const columns = getEntityColumns(ZoneEntryAuthorityArtifactEntity);
      assert.equal(
        columns.length,
        6,
        `Expected 6 columns on ZoneEntryAuthorityArtifactEntity, found ${columns.length}`,
      );
    });

    for (const spec of expectedArtifactColumns) {
      it(`configures column '${spec.propOrCol}' (${spec.dbName}) correctly`, () => {
        assertColumnMatches(ZoneEntryAuthorityArtifactEntity, spec);
      });
    }

    it('enforces composite UNIQUE(artifact_id, request_id) for composite FK reference', () => {
      assertHasUnique(ZoneEntryAuthorityArtifactEntity, ['artifactId', 'requestId']);
    });

    it('configures foreign key to mf06_assessment_request(request_id) ON DELETE RESTRICT', () => {
      assertHasForeignKey(
        ZoneEntryAuthorityArtifactEntity,
        ZoneEntryAssessmentRequestEntity,
        ['requestId'],
        ['requestId'],
        { onDelete: 'RESTRICT' },
      );
    });

    it('enforces canonical sha256 64-hex regex check constraint', () => {
      assertHasCheckRegex(
        ZoneEntryAuthorityArtifactEntity,
        /sha256\s*~\s*'\^\[0-9a-f\]\{64\}\$'/,
        'sha256 lowercase 64-hex regex',
      );
    });

    it('enforces db body_hash 64-hex regex check constraint', () => {
      assertHasCheckRegex(
        ZoneEntryAuthorityArtifactEntity,
        /body_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'/,
        'body_hash lowercase 64-hex regex',
      );
    });

    it('enforces body size limit check constraint (octet_length <= 2MB)', () => {
      assertHasCheckRegex(
        ZoneEntryAuthorityArtifactEntity,
        /octet_length\s*\(\s*body::text\s*\)\s*<=\s*2097152/,
        'body size limit 2097152 bytes',
      );
    });

    it('enforces stored_at finite check constraint', () => {
      assertHasCheckRegex(
        ZoneEntryAuthorityArtifactEntity,
        /isfinite\s*\(\s*stored_at\s*\)/,
        'isfinite(stored_at)',
      );
    });
  });

  describe('Suite 3: ZoneEntryAssessmentEntity TypeORM Columns & Operational Attributes', () => {
    const expectedAssessmentColumns: ExpectedColumnSpec[] = [
      {
        propOrCol: 'assessmentId',
        dbName: 'assessment_id',
        type: 'uuid',
        nullable: false,
        isPrimary: true,
      },
      {
        propOrCol: 'requestId',
        dbName: 'request_id',
        type: 'uuid',
        nullable: false,
      },
      {
        propOrCol: 'commandId',
        dbName: 'command_id',
        type: 'uuid',
        nullable: false,
      },
      {
        propOrCol: 'commandHash',
        dbName: 'command_hash',
        type: 'char',
        length: 64,
        nullable: false,
      },
      {
        propOrCol: 'siteId',
        dbName: 'site_id',
        type: 'uuid',
        nullable: false,
      },
      {
        propOrCol: 'eventId',
        dbName: 'event_id',
        type: 'uuid',
        nullable: false,
      },
      {
        propOrCol: 'bindingHash',
        dbName: 'binding_hash',
        type: 'char',
        length: 64,
        nullable: false,
      },
      {
        propOrCol: 'outcome',
        dbName: 'outcome',
        type: 'varchar',
        length: 16,
        nullable: false,
      },
      {
        propOrCol: 'reasonCode',
        dbName: 'reason_code',
        type: 'varchar',
        length: 32,
        nullable: false,
      },
      {
        propOrCol: 'evaluatorVersion',
        dbName: 'evaluator_version',
        type: 'varchar',
        length: 128,
        nullable: false,
      },
      {
        propOrCol: 'provenance',
        dbName: 'provenance',
        type: 'varchar',
        length: 16,
        nullable: false,
      },
      {
        propOrCol: 'workerId',
        dbName: 'worker_id',
        type: 'uuid',
        nullable: true,
      },
      {
        propOrCol: 'profileRevision',
        dbName: 'profile_revision',
        type: 'uuid',
        nullable: true,
      },
      {
        propOrCol: 'frameSha256',
        dbName: 'frame_sha256',
        type: 'char',
        length: 64,
        nullable: true,
      },
      {
        propOrCol: 'cropSha256',
        dbName: 'crop_sha256',
        type: 'char',
        length: 64,
        nullable: true,
      },
      {
        propOrCol: 'authorityArtifactId',
        dbName: 'authority_artifact_id',
        type: 'uuid',
        nullable: true,
      },
      {
        propOrCol: 'claimHeadRevision',
        dbName: 'claim_head_revision',
        type: 'integer',
        nullable: false,
      },
      {
        propOrCol: 'claimLeaseToken',
        dbName: 'claim_lease_token',
        type: 'uuid',
        nullable: false,
      },
      {
        propOrCol: 'assessedAt',
        dbName: 'assessed_at',
        type: 'timestamptz',
        nullable: false,
      },
    ];

    it('declares exactly the 19 columns matching candidate migration DDL', () => {
      const columns = getEntityColumns(ZoneEntryAssessmentEntity);
      assert.equal(
        columns.length,
        19,
        `Expected 19 columns on ZoneEntryAssessmentEntity, found ${columns.length}`,
      );
    });

    for (const spec of expectedAssessmentColumns) {
      it(`configures column '${spec.propOrCol}' (${spec.dbName}) correctly`, () => {
        assertColumnMatches(ZoneEntryAssessmentEntity, spec);
      });
    }

    it('permits unavailable identity and evidence with explicit nullable fields', () => {
      const privacyCols = [
        'workerId',
        'profileRevision',
        'frameSha256',
        'cropSha256',
        'authorityArtifactId',
      ];
      for (const prop of privacyCols) {
        const col = findEntityColumn(ZoneEntryAssessmentEntity, prop);
        assert.ok(col, `Privacy column '${prop}' must exist`);
        assert.equal(
          col.options.nullable,
          true,
          `Privacy column '${prop}' must allow null for unavailable identity`,
        );
      }
    });

    it('enforces operational non-nullability on core request, lease, and tenant scoping columns', () => {
      const operationalCols = [
        'assessmentId',
        'requestId',
        'commandId',
        'commandHash',
        'siteId',
        'eventId',
        'bindingHash',
        'outcome',
        'reasonCode',
        'evaluatorVersion',
        'provenance',
        'claimHeadRevision',
        'claimLeaseToken',
        'assessedAt',
      ];
      for (const prop of operationalCols) {
        const col = findEntityColumn(ZoneEntryAssessmentEntity, prop);
        assert.ok(col, `Operational column '${prop}' must exist`);
        assert.notEqual(
          col.options.nullable,
          true,
          `Operational column '${prop}' must not be nullable`,
        );
      }
    });
  });

  describe('Suite 4: ZoneEntryAssessmentEntity Constraints, Indexes & Foreign Keys', () => {
    it('enforces UNIQUE on request_id (at most one assessment per request)', () => {
      assertHasUnique(ZoneEntryAssessmentEntity, ['requestId']);
    });

    it('enforces UNIQUE on command_id (idempotent command boundary)', () => {
      assertHasUnique(ZoneEntryAssessmentEntity, ['commandId']);
    });

    it('enforces UNIQUE on authority_artifact_id (strictly 1:1 artifact attachment)', () => {
      assertHasUnique(ZoneEntryAssessmentEntity, ['authorityArtifactId']);
    });

    it('configures foreign key to mf06_assessment_request(request_id) ON DELETE RESTRICT', () => {
      assertHasForeignKey(
        ZoneEntryAssessmentEntity,
        ZoneEntryAssessmentRequestEntity,
        ['requestId'],
        ['requestId'],
        { onDelete: 'RESTRICT' },
      );
    });

    it('configures composite foreign key fk_mf06_assessment_artifact to mf06_authority_artifact(artifact_id, request_id) ON DELETE RESTRICT', () => {
      assertHasForeignKey(
        ZoneEntryAssessmentEntity,
        ZoneEntryAuthorityArtifactEntity,
        ['authorityArtifactId', 'requestId'],
        ['artifactId', 'requestId'],
        {
          name: 'fk_mf06_assessment_artifact',
          onDelete: 'RESTRICT',
        },
      );
    });

    it('configures composite index idx_mf06_assessment_site_time on (site_id, assessed_at, assessment_id)', () => {
      const indices = getEntityIndices(ZoneEntryAssessmentEntity);
      const found = indices.find(
        (idx) =>
          idx.name === 'idx_mf06_assessment_site_time' ||
          (Array.isArray(idx.columns) &&
            idx.columns.length === 3 &&
            ['siteId', 'site_id'].includes(String(idx.columns[0])) &&
            ['assessedAt', 'assessed_at'].includes(String(idx.columns[1])) &&
            ['assessmentId', 'assessment_id'].includes(String(idx.columns[2]))),
      );
      assert.ok(
        found,
        'Index idx_mf06_assessment_site_time on (siteId, assessedAt, assessmentId) must exist',
      );
      if (found.name) {
        assert.equal(
          found.name,
          'idx_mf06_assessment_site_time',
          "Index name must match 'idx_mf06_assessment_site_time'",
        );
      }
    });
  });

  describe('Suite 5: ZoneEntryAssessmentEntity Business Integrity & Check Constraints', () => {
    it('enforces 64-hex regex check constraints on command_hash and binding_hash', () => {
      assertHasCheckRegex(
        ZoneEntryAssessmentEntity,
        /command_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'/,
        'command_hash 64-hex regex',
      );
      assertHasCheckRegex(
        ZoneEntryAssessmentEntity,
        /binding_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'/,
        'binding_hash 64-hex regex',
      );
    });

    it('enforces 64-hex regex check constraints on frame_sha256 and crop_sha256', () => {
      assertHasCheckRegex(
        ZoneEntryAssessmentEntity,
        /frame_sha256\s*~\s*'\^\[0-9a-f\]\{64\}\$'/,
        'frame_sha256 64-hex regex',
      );
      assertHasCheckRegex(
        ZoneEntryAssessmentEntity,
        /crop_sha256\s*~\s*'\^\[0-9a-f\]\{64\}\$'/,
        'crop_sha256 64-hex regex',
      );
    });

    it("enforces outcome IN ('ALLOWED','DENIED','UNAVAILABLE') check constraint", () => {
      assertHasCheckRegex(
        ZoneEntryAssessmentEntity,
        /outcome\s+IN\s*\(\s*'ALLOWED'\s*,\s*'DENIED'\s*,\s*'UNAVAILABLE'\s*\)/,
        'outcome enum values',
      );
    });

    it("enforces provenance IN ('UNAVAILABLE','SYNTHETIC_TEST','TRUSTED_SERVICE') check constraint", () => {
      assertHasCheckRegex(
        ZoneEntryAssessmentEntity,
        /provenance\s+IN\s*\(\s*'UNAVAILABLE'\s*,\s*'SYNTHETIC_TEST'\s*,\s*'TRUSTED_SERVICE'\s*\)/,
        'provenance enum values',
      );
    });

    it('enforces non-empty and trimmed evaluator_version check constraint', () => {
      assertHasCheckRegex(
        ZoneEntryAssessmentEntity,
        /char_length\s*\(\s*evaluator_version\s*\)\s*>\s*0\s+AND\s+evaluator_version\s*=\s*btrim\s*\(\s*evaluator_version\s*\)/,
        'evaluator_version non-empty and trimmed',
      );
    });

    it('enforces claim_head_revision > 0 check constraint', () => {
      assertHasCheckRegex(
        ZoneEntryAssessmentEntity,
        /claim_head_revision\s*>\s*0/,
        'claim_head_revision positive integer',
      );
    });

    it('enforces isfinite(assessed_at) check constraint', () => {
      assertHasCheckRegex(
        ZoneEntryAssessmentEntity,
        /isfinite\s*\(\s*assessed_at\s*\)/,
        'isfinite(assessed_at)',
      );
    });

    it('enforces the exact outcome and reason_code mapping check constraint matrix', () => {
      assertHasCheckRegex(
        ZoneEntryAssessmentEntity,
        /outcome\s*=\s*'ALLOWED'\s+AND\s+reason_code\s+IN\s*\(\s*'POLICY_NONE'\s*,\s*'AUTHORIZED'\s*\)/,
        'ALLOWED reason codes',
      );
      assertHasCheckRegex(
        ZoneEntryAssessmentEntity,
        /outcome\s*=\s*'DENIED'\s+AND\s+reason_code\s+IN\s*\(\s*'POLICY_PROHIBITED'\s*,\s*'UNAUTHORIZED'\s*\)/,
        'DENIED reason codes',
      );
      assertHasCheckRegex(
        ZoneEntryAssessmentEntity,
        /outcome\s*=\s*'UNAVAILABLE'\s+AND\s+reason_code\s+IN\s*\(\s*'INVALID_BINDING'\s*,\s*'IDENTITY_UNAVAILABLE'\s*,\s*'MEDIA_UNAVAILABLE'\s*,\s*'PROFILE_REVOKED'\s*,\s*'AUTHORITY_UNAVAILABLE'\s*,\s*'SERVICE_DISABLED'\s*,\s*'ABORTED'\s*\)/,
        'UNAVAILABLE reason codes',
      );
    });

    it('enforces that non-UNAVAILABLE outcome requires authority_artifact_id IS NOT NULL', () => {
      assertHasCheckRegex(
        ZoneEntryAssessmentEntity,
        /outcome\s*=\s*'UNAVAILABLE'\s+OR\s+authority_artifact_id\s+IS\s+NOT\s+NULL/,
        'non-UNAVAILABLE requires artifact',
      );
    });

    it('enforces evidence completeness check when reason_code is AUTHORIZED or UNAUTHORIZED', () => {
      assertHasCheckRegex(
        ZoneEntryAssessmentEntity,
        /reason_code\s+NOT\s+IN\s*\(\s*'AUTHORIZED'\s*,\s*'UNAUTHORIZED'\s*\)\s+OR\s*\(\s*worker_id\s+IS\s+NOT\s+NULL\s+AND\s+profile_revision\s+IS\s+NOT\s+NULL\s+AND\s+frame_sha256\s+IS\s+NOT\s+NULL\s+AND\s+crop_sha256\s+IS\s+NOT\s+NULL\s+AND\s+provenance\s*<>\s*'UNAVAILABLE'\s*\)/,
        'identity completeness for AUTHORIZED/UNAUTHORIZED',
      );
    });
  });
});
