import { readFileSync, writeFileSync } from 'fs';

const targetVersion = process.env.npm_package_version;
// Guard: this script must run via npm scripts (npm run version-bump), which
// injects npm_package_version. Running it bare (e.g. `node version-bump.mjs`)
// would clobber manifest.json with version "undefined" and drop the key.
if (!targetVersion || targetVersion === 'undefined') {
	console.error(
		'version-bump: npm_package_version is not set — run `npm run version-bump`, not `node version-bump.mjs` directly.',
	);
	process.exit(1);
}

// read minAppVersion from manifest.json and bump version to target version
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t'));

// update versions.json with target version and minAppVersion from manifest.json
// but only if the target version is not already in versions.json
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
if (!(targetVersion in versions)) {
	versions[targetVersion] = minAppVersion;
	writeFileSync('versions.json', JSON.stringify(versions, null, '\t'));
}
