// Stub types for Zstd compression classes added in Node.js 23.8.0
// Required for minizlib's type definitions which reference these types
declare module 'zlib' {
	interface ZstdCompress extends NodeJS.ReadWriteStream {}
	interface ZstdDecompress extends NodeJS.ReadWriteStream {}
}
