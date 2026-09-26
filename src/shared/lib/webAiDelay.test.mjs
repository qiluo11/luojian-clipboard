import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { webAiDelayFromSeconds, webAiSiteKey } from './webAiDelay.ts';

describe('Web AI website delay', () => {
    for (const [url, site] of [
        ['https://www.doubao.com/chat', 'doubao.com'],
        [' http://DOUBAO.COM./?x=1#chat ', 'doubao.com'],
        ['https://chat.deepseek.com/a', 'chat.deepseek.com'],
        ['http://localhost:3000/a', 'localhost:3000'],
        ['http://example.com:443/', 'example.com:443'],
        ['https://example.com:80/', 'example.com:80'],
        ['https://example.com:443/', 'example.com'],
        ['http://[::1]:3000/', '[::1]:3000'],
        ['https://other.doubao.com', 'other.doubao.com'],
        ['', null], ['doubao.com', null], ['file:///c:/test', null],
        ['javascript:alert(1)', null], ['https://user:pass@doubao.com', null],
    ]) it(`normalizes ${url}`, () => assert.equal(webAiSiteKey(url), site));

    for (const [draft, ms] of [
        ['0', 0], ['1.5', 1500], ['5', 5000], ['60', 60000], ['0.001', 1],
        ['', null], [' ', null], ['-', null], ['NaN', null], ['Infinity', null],
        ['-1', null], ['60.001', null],
    ]) it(`validates seconds draft ${JSON.stringify(draft)}`, () => assert.equal(webAiDelayFromSeconds(draft), ms));
});
