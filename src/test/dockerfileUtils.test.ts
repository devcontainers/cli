import { assert } from 'chai';
import { ensureDockerfileHasFinalStageName } from '../spec-node/utils';

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