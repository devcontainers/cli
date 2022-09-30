export interface Template {
	id: string;
	version?: string;
	name?: string;
	description?: string;
	documentationURL?: string;
	licenseURL?: string;
	type?: string;
	fileCount?: number;
	options?: Record<string, TemplateOption>;
	platforms?: string[];
	publisher?: string;
	keywords?: string[];
}

export type TemplateOption = {
	type: 'boolean';
	default: boolean;
	replaceIn: string[];
	description?: string;
} | {
	type: 'string';
	default: boolean;
	replaceIn: string[];
	enum?: string[];
	description?: string;
} | {
	type: 'string';
	default: boolean;
	replaceIn: string[];
	proposals?: string[];
	description?: string;
};
