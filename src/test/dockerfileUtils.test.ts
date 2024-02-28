import { assert } from 'chai';
import { imageMetadataLabel, internalGetImageBuildInfoFromDockerfile } from '../spec-node/imageMetadata';
import { ensureDockerfileHasFinalStageName, extractDockerfile, findBaseImage, findUserStatement, supportsBuildContexts } from '../spec-node/dockerfileUtils';
import { ImageDetails } from '../spec-shutdown/dockerUtils';
import { nullLog } from '../spec-utils/log';
import { testSubstitute } from './testUtils';

describe('ensureDockerfileHasFinalStageName', () => {

    describe('with named last stage it should return the stage name and no modifications', () => {
        it('for a simple FROM line', () => {
            const dockerfile = `
FROM ubuntu:latest as base

RUN some command

FROM base as final

COPY src dest
RUN another command
`;
            const { lastStageName, modifiedDockerfile } = ensureDockerfileHasFinalStageName(dockerfile, 'placeholder');
            assert.equal(lastStageName, 'final');
            assert.isUndefined(modifiedDockerfile);
        });
    });

    describe('for a FROM line indented and followed by a comment', () => {
        it('should return the stage name', () => {
            const dockerfile = `
FROM ubuntu:latest as base

RUN some command

 \tFROM base  as\t  final  #<- deliberately mixing with whitespace and including: as something here

COPY src dest
RUN another command
`;
            const { lastStageName, modifiedDockerfile } = ensureDockerfileHasFinalStageName(dockerfile, 'placeholder');
            assert.equal(lastStageName, 'final');
            assert.isUndefined(modifiedDockerfile);
        });
    });

    describe('for a FROM line with platform and named last stage indented and followed by a comment', () => {
        it('should return the stage name', () => {
            const dockerfile = `
FROM ubuntu:latest as base

RUN some command

 \tFROM  --platform=my-platform \tbase  as\t  final  #<- deliberately mixing with whitespace and including: as something here

COPY src dest
RUN another command
`;
            const { lastStageName, modifiedDockerfile } = ensureDockerfileHasFinalStageName(dockerfile, 'placeholder');
            assert.equal(lastStageName, 'final');
            assert.isUndefined(modifiedDockerfile);
        });
    });


    describe('without a named last stage', () => {
        describe('for a simple FROM line', () => {
            const dockerfile = `
FROM ubuntu:latest as base

RUN some command

FROM base

COPY src dest
RUN another command
`;
            it('should return the placeholder as the last stage name', () => {
                const { lastStageName } = ensureDockerfileHasFinalStageName(dockerfile, 'placeholder');
                assert.equal(lastStageName, 'placeholder');
            });
            it('should return modified Dockerfile with stage name', () => {
                const { modifiedDockerfile } = ensureDockerfileHasFinalStageName(dockerfile, 'placeholder');
                assert.equal(modifiedDockerfile, `
FROM ubuntu:latest as base

RUN some command

FROM base AS placeholder

COPY src dest
RUN another command
`);
            });
        });
        describe('for a simple, trailing FROM line', () => {
            const dockerfile = `
FROM ubuntu:latest as base

RUN some command

FROM base`;
            it('should return the placeholder as the last stage name', () => {
                const { lastStageName } = ensureDockerfileHasFinalStageName(dockerfile, 'placeholder');
                assert.equal(lastStageName, 'placeholder');
            });
            it('should return modified Dockerfile with stage name', () => {
                const { modifiedDockerfile } = ensureDockerfileHasFinalStageName(dockerfile, 'placeholder');
                assert.equal(modifiedDockerfile, `
FROM ubuntu:latest as base

RUN some command

FROM base AS placeholder`);
            });
        });
        describe('for a FROM line with platform and followed by a comment', () => {
            const dockerfile = `
FROM ubuntu:latest as base

RUN some command

 \tFROM  --platform=my-platform \tbase   #<- deliberately mixing with whitespace and including: as something here

COPY src dest
RUN another command
`;
            it('should return the placeholder as the last stage name', () => {
                const { lastStageName } = ensureDockerfileHasFinalStageName(dockerfile, 'placeholder');
                assert.equal(lastStageName, 'placeholder');
            });
            it('should return modified Dockerfile with stage name', () => {
                const { modifiedDockerfile } = ensureDockerfileHasFinalStageName(dockerfile, 'placeholder');
                assert.equal(modifiedDockerfile, `
FROM ubuntu:latest as base

RUN some command

 \tFROM  --platform=my-platform \tbase AS placeholder   #<- deliberately mixing with whitespace and including: as something here

COPY src dest
RUN another command
`);
            });
        });
    });
});

describe('getImageBuildInfo', () => {

    it('for a simple FROM line', async () => {
        const dockerfile = `FROM debian:latest as base
FROM ubuntu:latest as dev
`;
        const details: ImageDetails = {
            Id: '123',
            Config: {
                User: 'imageUser',
                Env: null,
                Labels: {
                    [imageMetadataLabel]: '[{"id":"testid"}]'
                },
                Entrypoint: null,
                Cmd: null
            },
						Os: 'linux',
						Architecture: 'amd64'
        };
        const info = await internalGetImageBuildInfoFromDockerfile(async (imageName) => {
            assert.strictEqual(imageName, 'ubuntu:latest');
            return details;
        }, dockerfile, {}, undefined, testSubstitute, nullLog, false);
        assert.strictEqual(info.user, 'imageUser');
        assert.strictEqual(info.metadata.config.length, 1);
        assert.strictEqual(info.metadata.config[0].id, 'testid-substituted');
        assert.strictEqual(info.metadata.raw.length, 1);
        assert.strictEqual(info.metadata.raw[0].id, 'testid');
    });

    it('for a USER', async () => {
        const dockerfile = `FROM ubuntu:latest as base
USER dockerfileUserA
USER dockerfileUserB
`;
        const details: ImageDetails = {
            Id: '123',
            Config: {
                User: 'imageUser',
                Env: null,
                Labels: null,
                Entrypoint: null,
                Cmd: null
            },
						Os: 'linux',
						Architecture: 'amd64'
        };
        const info = await internalGetImageBuildInfoFromDockerfile(async (imageName) => {
            assert.strictEqual(imageName, 'ubuntu:latest');
            return details;
        }, dockerfile, {}, undefined, testSubstitute, nullLog, false);
        assert.strictEqual(info.user, 'dockerfileUserB');
        assert.strictEqual(info.metadata.config.length, 0);
        assert.strictEqual(info.metadata.raw.length, 0);
    });
});

describe('findBaseImage', () => {

    it('simple FROM', async () => {
        const dockerfile = `FROM image1
USER user1
`;
        const extracted = extractDockerfile(dockerfile);
        const image = findBaseImage(extracted, {}, undefined);
        assert.strictEqual(image, 'image1');
    });

    it('arg FROM', async () => {
        const dockerfile = `ARG BASE_IMAGE="image2"
FROM \${BASE_IMAGE}
ARG IMAGE_USER=user2
USER $IMAGE_USER
`;
        const extracted = extractDockerfile(dockerfile);
        const image = findBaseImage(extracted, {}, undefined);
        assert.strictEqual(image, 'image2');
    });

    it('arg FROM overwritten', async () => {
        const dockerfile = `ARG BASE_IMAGE="image2"
FROM \${BASE_IMAGE}
ARG IMAGE_USER=user2
USER $IMAGE_USER
`;
        const extracted = extractDockerfile(dockerfile);
        const image = findBaseImage(extracted, {
            'BASE_IMAGE': 'image3'
        }, undefined);
        assert.strictEqual(image, 'image3');
    });

    it('Multistage', async () => {
        const dockerfile = `
FROM image1 as stage1
FROM stage3 as stage2
FROM image3 as stage3
FROM image4 as stage4
`;
        const extracted = extractDockerfile(dockerfile);
        const image = findBaseImage(extracted, {}, 'stage2');
        assert.strictEqual(image, 'image3');
    });

    it('Quoted', async () => {
        const dockerfile = `
ARG BASE_IMAGE="ubuntu:latest"

FROM "\${BASE_IMAGE}"
`;
        const extracted = extractDockerfile(dockerfile);
        assert.strictEqual(extracted.stages.length, 1);
        const image = findBaseImage(extracted, {}, undefined);
        assert.strictEqual(image, 'ubuntu:latest');
    });

    describe('Variable substitution', () => {
        it('Positive variable expression with value specified', async () => {
            const dockerfile = `
ARG cloud
FROM \${cloud:+mcr.microsoft.com/}azure-cli:latest
`;
            const extracted = extractDockerfile(dockerfile);
            assert.strictEqual(extracted.stages.length, 1);
            const image = findBaseImage(extracted, {
                'cloud': 'true'
            }, undefined);
            assert.strictEqual(image, 'mcr.microsoft.com/azure-cli:latest');
        });

        it('Positive variable expression with no value specified', async () => {
            const dockerfile = `
ARG cloud
FROM \${cloud:+mcr.microsoft.com/}azure-cli:latest
`;
            const extracted = extractDockerfile(dockerfile);
            assert.strictEqual(extracted.stages.length, 1);
            const image = findBaseImage(extracted, {}, undefined);
            assert.strictEqual(image, 'azure-cli:latest');
        });

        it('Negative variable expression with value specified', async () => {
            const dockerfile = `
ARG cloud
FROM \${cloud:-mcr.microsoft.com/}azure-cli:latest
`;
            const extracted = extractDockerfile(dockerfile);
            assert.strictEqual(extracted.stages.length, 1);
            const image = findBaseImage(extracted, {
                'cloud': 'ghcr.io/'
            }, undefined);
            assert.strictEqual(image, 'ghcr.io/azure-cli:latest');
        });

        it('Negative variable expression with no value specified', async () => {
            const dockerfile = `
ARG cloud
FROM \${cloud:-mcr.microsoft.com/}azure-cli:latest
`;
            const extracted = extractDockerfile(dockerfile);
            assert.strictEqual(extracted.stages.length, 1);
            const image = findBaseImage(extracted, {}, undefined);
            assert.strictEqual(image, 'mcr.microsoft.com/azure-cli:latest');
        });

        describe('Quoted', async () => {
          it('Positive variable expression with value specified', async () => {
            const dockerfile = `
ARG cloud
FROM \${cloud:+"mcr.microsoft.com/"}azure-cli:latest"
`;
            const extracted = extractDockerfile(dockerfile);
            assert.strictEqual(extracted.stages.length, 1);
            const image = findBaseImage(
              extracted,
              {
                cloud: 'true',
              },
              undefined
            );
            assert.strictEqual(image, 'mcr.microsoft.com/azure-cli:latest');
          });

          it('Positive variable expression with no value specified', async () => {
            const dockerfile = `
ARG cloud
FROM "\${cloud:+"mcr.microsoft.com/"}azure-cli:latest"
`;

            const extracted = extractDockerfile(dockerfile);
            assert.strictEqual(extracted.stages.length, 1);
            const image = findBaseImage(extracted, {}, undefined);
            assert.strictEqual(image, 'azure-cli:latest');
          });

          it('Negative variable expression with value specified', async () => {
            const dockerfile = `
ARG cloud
FROM "\${cloud:-"mcr.microsoft.com/"}azure-cli:latest"
`;

            const extracted = extractDockerfile(dockerfile);
            assert.strictEqual(extracted.stages.length, 1);
            const image = findBaseImage(
              extracted,
              {
                cloud: 'ghcr.io/',
              },
              undefined
            );
            assert.strictEqual(image, 'ghcr.io/azure-cli:latest');
          });

          it('Negative variable expression with no value specified', async () => {
            const dockerfile = `
ARG cloud
FROM \${cloud:-"mcr.microsoft.com/"}azure-cli:latest as label
`;

            const extracted = extractDockerfile(dockerfile);
            assert.strictEqual(extracted.stages.length, 1);
            const image = findBaseImage(extracted, {}, undefined);
            assert.strictEqual(image, 'mcr.microsoft.com/azure-cli:latest');
          });
        });
    });
});

describe('findUserStatement', () => {

    it('simple USER', async () => {
        const dockerfile = `FROM debian
USER user1
`;
        const extracted = extractDockerfile(dockerfile);
        const user = findUserStatement(extracted, {}, {}, undefined);
        assert.strictEqual(user, 'user1');
    });

    it('arg USER', async () => {
        const dockerfile = `FROM debian
ARG IMAGE_USER=user2
USER $IMAGE_USER
`;
        const extracted = extractDockerfile(dockerfile);
        const user = findUserStatement(extracted, {}, {}, undefined);
        assert.strictEqual(user, 'user2');
    });

    it('arg USER overwritten', async () => {
        const dockerfile = `FROM debian
ARG IMAGE_USER=user2
USER $IMAGE_USER
`;
        const extracted = extractDockerfile(dockerfile);
        const user = findUserStatement(extracted, {
            IMAGE_USER: 'user3'
        }, {}, undefined);
        assert.strictEqual(user, 'user3');
    });

    it('Multistage', async () => {
        const dockerfile = `
FROM image1 as stage1
USER user1
FROM stage3 as stage2
FROM image3 as stage3
USER user3_1
USER user3_2
FROM image4 as stage4
USER user4
`;
        const extracted = extractDockerfile(dockerfile);
        const image = findUserStatement(extracted, {}, {}, 'stage2');
        assert.strictEqual(image, 'user3_2');
    });

    it('ARG after ENV', async () => {
        const dockerfile = `
FROM debian
ENV USERNAME=user1
ARG USERNAME=user2
USER \${USERNAME}
`;
        const extracted = extractDockerfile(dockerfile);
        const user = findUserStatement(extracted, {}, {}, undefined);
        assert.strictEqual(user, 'user2');
    });

    it('ARG after ENV in preceding stage', async () => {
        const dockerfile = `
FROM debian as one
ENV USERNAME=user1
ARG USERNAME=user2

FROM one as two
USER \${USERNAME}
`;
        const extracted = extractDockerfile(dockerfile);
        const user = findUserStatement(extracted, {}, {}, undefined);
        assert.strictEqual(user, 'user1');
    });

    it('ARG in preamble', async () => {
        const dockerfile = `
ARG USERNAME=user1
FROM debian
USER \${USERNAME}
`;
        const extracted = extractDockerfile(dockerfile);
        const user = findUserStatement(extracted, {}, {}, undefined);
        assert.strictEqual(user, 'user1');
    });

    it('unbound ARG after ENV', async () => {
        const dockerfile = `
FROM debian
ENV USERNAME=user1
ARG USERNAME
USER \${USERNAME}
`;
        const extracted = extractDockerfile(dockerfile);
        const user = findUserStatement(extracted, {}, {}, undefined);
        assert.strictEqual(user, 'user1');
    });

    it('unbound', async () => {
        const dockerfile = `
FROM debian
USER \${USERNAME}
`;
        const extracted = extractDockerfile(dockerfile);
        const user = findUserStatement(extracted, {}, {}, undefined);
        assert.strictEqual(user, undefined);
    });

    it('ENV after ARG', async () => {
        const dockerfile = `
FROM debian
ARG USERNAME=user1
ENV USERNAME=user2
USER \${USERNAME}
`;
        const extracted = extractDockerfile(dockerfile);
        const user = findUserStatement(extracted, {}, {}, undefined);
        assert.strictEqual(user, 'user2');
    });

    it('ENV set from ARG', async () => {
        const dockerfile = `
FROM debian
ARG USERNAME1=user1
ENV USERNAME2=\${USERNAME1}
USER \${USERNAME2}
`;
        const extracted = extractDockerfile(dockerfile);
        const user = findUserStatement(extracted, {}, {}, undefined);
        assert.strictEqual(user, 'user1');
    });

    it('multiple variables', async () => {
        const dockerfile = `
FROM debian
ARG USERNAME1=user1
ENV USERNAME2=user2
USER A\${USERNAME1}A\${USERNAME2}A
`;
        const extracted = extractDockerfile(dockerfile);
        const user = findUserStatement(extracted, {}, {}, undefined);
        assert.strictEqual(user, 'Auser1Auser2A');
    });

    it('ENV in base image', async () => {
        const dockerfile = `
FROM mybase
USER \${USERNAME}
`;
        const extracted = extractDockerfile(dockerfile);
        const user = findUserStatement(extracted, {}, { USERNAME: 'user1' }, undefined);
        assert.strictEqual(user, 'user1');
    });
});

describe('supportsBuildContexts', () => {

    it('no syntax directive', async () => {
        const dockerfile = `FROM debian`;
        const extracted = extractDockerfile(dockerfile);
        assert.strictEqual(supportsBuildContexts(extracted), false);
    });

    it('matching syntax directive', async () => {
        const dockerfile = `# syntax=docker/dockerfile:1.4
FROM debian`;
        const extracted = extractDockerfile(dockerfile);
        assert.strictEqual(supportsBuildContexts(extracted), true);
    });

    it('matching syntax directive with docker.io', async () => {
        const dockerfile = `# syntax=docker.io/docker/dockerfile:1.4
FROM debian`;
        const extracted = extractDockerfile(dockerfile);
        assert.strictEqual(supportsBuildContexts(extracted), true);
    });

    it('unknown syntax directive', async () => {
        const dockerfile = `# syntax=mycompany/myimage:1.4
FROM debian`;
        const extracted = extractDockerfile(dockerfile);
        assert.strictEqual(supportsBuildContexts(extracted), 'unknown');
    });

    ['', '-labs'].forEach(prerelease => {
        [
            ['0', false],
            ['1', true],
            ['1.2', false],
            ['1.2.3', false],
            ['1.4', true],
            ['1.4.5', true],
            ['1.5', true],
            ['1.5.0', true],
            ['2', true],
            ['', true],
            ['latest', true],
        ].forEach(([version, expected]) => {
            const tag = `${version}${prerelease}`;
            it(`syntax directive: ${tag}`, async () => {
                const dockerfile = `# syntax=docker.io/docker/dockerfile${tag ? `:${tag}` : ''}
        FROM debian`;
                const extracted = extractDockerfile(dockerfile);
                assert.strictEqual(supportsBuildContexts(extracted), expected);
            });
        });
    });
});

describe('extractDockerfile', () => {

    it('handles ENV with equals', async () => {
        const dockerfile = `FROM debian\nENV A=B`;
        const extracted = extractDockerfile(dockerfile);
        const env = extracted.stages[0].instructions[0];
        assert.strictEqual(env.instruction, 'ENV');
        assert.strictEqual(env.name, 'A');
        assert.strictEqual(env.value, 'B');
    });

    it('handles ENV with equals and spaces', async () => {
        const dockerfile = `FROM debian\nENV A = B`;
        const extracted = extractDockerfile(dockerfile);
        const env = extracted.stages[0].instructions[0];
        assert.strictEqual(env.instruction, 'ENV');
        assert.strictEqual(env.name, 'A');
        assert.strictEqual(env.value, 'B');
    });

    it('handles ENV without equals', async () => {
        const dockerfile = `FROM debian\nENV A B`;
        const extracted = extractDockerfile(dockerfile);
        const env = extracted.stages[0].instructions[0];
        assert.strictEqual(env.instruction, 'ENV');
        assert.strictEqual(env.name, 'A');
        assert.strictEqual(env.value, 'B');
    });

    it('lowercase instructions', async () => {
        const dockerfile = `from E
env A=B
arg C
user D
`;
        const extracted = extractDockerfile(dockerfile);
        assert.strictEqual(extracted.stages.length, 1);

        const stage = extracted.stages[0];
        assert.strictEqual(stage.from.image, 'E');
        assert.strictEqual(stage.instructions.length, 3);

        const env = stage.instructions[0];
        assert.strictEqual(env.instruction, 'ENV');
        assert.strictEqual(env.name, 'A');
        assert.strictEqual(env.value, 'B');

        const arg = stage.instructions[1];
        assert.strictEqual(arg.instruction, 'ARG');
        assert.strictEqual(arg.name, 'C');

        const user = stage.instructions[2];
        assert.strictEqual(user.instruction, 'USER');
        assert.strictEqual(user.name, 'D');
    });
});
