const fs = require('node:fs');
const path = require('node:path');

const axios = require('axios');
const postcssPreset = require('postcss-preset-env');

const { updateChangelog } = require('./markdown');

function findPathInParent(endPath) {
    let parentPath = __dirname;
    while (parentPath !== path.join(parentPath, '..')) {
        const filePath = path.join(parentPath, endPath);
        if (fs.existsSync(filePath)) return filePath;
        parentPath = path.join(parentPath, '..');
    }
    const filePath = path.join(parentPath, endPath);
    if (fs.existsSync(filePath)) return filePath;

    return false;
}

function findPathInParentOrThrow(endPath) {
    const filePath = findPathInParent(endPath);
    if (!filePath) throw new Error(`Could not find ${endPath} in any parent directory`);
    return filePath;
}

async function generateChangelogFromGitHubReleases(paths, repo) {
    const response = await axios.get(`https://api.github.com/repos/${repo}/releases`);
    const releases = response.data;

    let markdown = '';
    if (!Array.isArray(releases) || releases.length === 0) return;

    releases.forEach((release) => {
        markdown += release.tag_name
            ? `## [${release.name}](https://github.com/${repo}/releases/tag/${release.tag_name})\n`
            : `## ${release.name}\n`;
        markdown += `${release.body.replaceAll(/(^#|\n#)/g, '###')}\n`;
    });

    paths.forEach((p) => {
        fs.writeFileSync(path.join(p, 'changelog.md'), updateChangelog(markdown));
    });
}

function copyChangelogFromRoot(paths, hasDefaultChangelog) {
    const sourceChangelogPath = findPathInParentOrThrow('CHANGELOG.md');

    for (const docsPath of paths) {
        const targetChangelogPath = path.join(docsPath, 'changelog.md');

        if (fs.existsSync(targetChangelogPath)
            && fs.statSync(targetChangelogPath).mtime >= fs.statSync(sourceChangelogPath).mtime
            && !hasDefaultChangelog.get(docsPath)) {
            continue;
        }

        const changelog = fs.readFileSync(sourceChangelogPath, 'utf-8');
        fs.writeFileSync(targetChangelogPath, updateChangelog(changelog));
    }
}

function theme(
    context,
    options,
) {
    return {
        name: '@apify/docs-theme',
        getPathsToWatch() {
            return ['./pages'];
        },
        getThemePath() {
            return '../src/theme';
        },
        getTypeScriptThemePath() {
            return '../src/theme';
        },
        async loadContent() {
            try {
                const versioned = findPathInParent('website/versioned_docs');
                const pathsToCopyChangelog = [
                    findPathInParentOrThrow('docs'),
                    ...(versioned
                        ? fs.readdirSync(versioned).map((version) => path.join(versioned, version))
                        : []
                    ),
                ];

                const hasDefaultChangelog = new Map();

                for (const p of pathsToCopyChangelog) {
                    // the changelog page has to exist for the sidebar to work - async loadContent() is (apparently) not awaited for by sidebar
                    if (fs.existsSync(path.join(p, 'changelog.md'))) continue;
                    fs.writeFileSync(`${p}/changelog.md`, `---
title: Changelog
sidebar_label: Changelog
---
It seems that the changelog is not available.
This either means that your Docusaurus setup is misconfigured, or that your GitHub repository contains no releases yet.
`);
                    hasDefaultChangelog.set(p, true);
                }

                if (options.changelogFromRoot) {
                    copyChangelogFromRoot(pathsToCopyChangelog, hasDefaultChangelog);
                } else {
                    await generateChangelogFromGitHubReleases(pathsToCopyChangelog, `${context.siteConfig.organizationName}/${context.siteConfig.projectName}`);
                }
            } catch (e) {
                console.warn(`Changelog page could not be initialized: ${e.message}`);
            }
        },
        async contentLoaded({ actions }) {
            const { setGlobalData } = actions;
            setGlobalData({
                options,
            });
        },
        getClientModules() {
            return [
                require.resolve('./theme/custom.css'),
            ];
        },
        configureWebpack() {
            return {
                module: {
                    rules: [
                        {
                            test: /(@apify\/|apify-)docs-theme\/src\/(theme|pages)\/.*?\.jsx?$/,
                            use: {
                                loader: 'babel-loader',
                            },
                        },
                    ],
                },
            };
        },
        configurePostCss(o) {
            o.plugins.push(postcssPreset); // allow newest CSS syntax
            return o;
        },
    };
}

module.exports = {
    theme,
};
