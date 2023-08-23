import { sentenceCase } from 'change-case';

export const formatStatus = (status: string) => {
	if (status === 'success') {
		return 'Ready';
	}
	return sentenceCase(status);
};
