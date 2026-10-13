import assert from 'node:assert/strict';
import test from 'node:test';
import { isReleaseVersion, isSemVer, isStableVersion, validateVersionAgreement } from '../tooling/version-policy.ts';

test('version policy accepts SemVer and rejects malformed or non-string versions', () => {
    for (const version of ['0.1.0', '12.34.56', '1.2.3-alpha.1+build.9', '1.2.3-any-Channel.42+Build.001']) {
        assert.equal(isSemVer(version), true, version);
    }
    for (const version of [
        '01.2.3',
        '1.02.3',
        '1.2.03',
        'v1.2.3',
        'V1.2.3',
        ' 1.2.3',
        '1.2.3 ',
        '1.2',
        '1.2.3-01',
        '1.2.3-alpha..1',
        '1.2.3+build..1',
        '1.2.3-',
        '1.2.3+',
        '1.2.3-alpha_',
        '1.2.3+build_',
        '1.2.3\n',
        '',
        null,
        undefined,
        1,
        {},
        ['1.2.3'],
    ]) {
        assert.equal(isSemVer(version), false, String(version));
        assert.equal(isStableVersion(version), false, String(version));
    }
    assert.equal(isStableVersion('12.34.56'), true);
    assert.equal(isStableVersion('1.2.3-alpha.1'), false);
    assert.equal(isStableVersion('1.2.3+build.9'), false);
});

for (const [accepted, rejected] of [
    ['9007199254740991.2.3', '9007199254740992.2.3'],
    ['1.9007199254740991.3', '1.9007199254740992.3'],
    ['1.2.9007199254740991', '1.2.9007199254740992'],
]) {
    test(`version policy bounds the core component in ${accepted}`, () => {
        assert.equal(isSemVer(accepted), true);
        assert.equal(isStableVersion(accepted), true);
        assert.equal(isSemVer(rejected), false);
        assert.equal(isStableVersion(rejected), false);
    });
}

test('version policy limits total length without limiting numeric prerelease identifiers to safe integers', () => {
    const longest = `1.2.3+${'a'.repeat(250)}`;
    assert.equal(longest.length, 256);
    assert.equal(isSemVer(longest), true);
    assert.equal(isSemVer(`${longest}a`), false);
    assert.equal(isSemVer('1.2.3-900719925474099200000000000000000000000'), true);
    assert.equal(isStableVersion('1.2.3-900719925474099200000000000000000000000'), false);
});

test('version agreement supports future releases without accepting invalid or mismatched metadata', () => {
    assert.deepEqual(validateVersionAgreement('0.1.0', '0.1.0'), []);
    assert.deepEqual(validateVersionAgreement('2.3.4', '2.3.4'), []);
    assert.deepEqual(validateVersionAgreement('1.2.3+build.1', '1.2.3+build.1'), []);
    for (const versions of [
        ['1.2.3', '1.2.4'],
        ['01.2.3', '01.2.3'],
        ['1.2.3+build.1', '1.2.3+build.2'],
        [null, null],
    ]) {
        assert.ok(validateVersionAgreement(versions[0], versions[1]).length);
    }
});

test('release predicate allows arbitrary legal prereleases without build metadata or normalized input', () => {
    for (const value of [
        '0.1.0',
        '12.34.56',
        '1.2.3-alpha.1',
        '1.2.3-any-Channel.42',
        '1.2.3-900719925474099200000000000000000000000',
        '9007199254740991.2.3',
        `1.2.3-${'a'.repeat(250)}`,
    ]) {
        assert.equal(isReleaseVersion(value), true, value);
    }
    for (const value of [
        'v1.2.3',
        'V1.2.3',
        ' 1.2.3',
        '1.2.3 ',
        '01.2.3',
        '1.2.3-01',
        '1.2.3-alpha..1',
        '1.2.3-alpha_',
        '1.2.3+build.1',
        '1.2.3-alpha.1+build.1',
        '9007199254740992.2.3',
        `1.2.3-${'a'.repeat(251)}`,
        null,
        1,
        {},
    ]) {
        assert.equal(isReleaseVersion(value), false, String(value));
    }
});
