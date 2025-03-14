import { jest } from '@jest/globals';
import nock from 'nock';
import { Blob } from 'node-fetch';
import { ClientV6 } from '../../../../src/client/v6';
import { Host } from '../../../../src/client/host';
import { Config, ConfigInterface } from '../../../../src/config/index';
import { ErrorNotification } from '../../../../src/notify';
import { Log } from '../../../../src/log';

describe('Client', () => {
  describe('V6', () => {
    const goodResponse =
      '{"session":{"valid":true,"totp":true,"sid":"IEFZjjlRXX0FMaemtB8opQ=","csrf":"+Y5Qx4Qxa5XXYSzz8Nu7gw=","validity":1800,"message":"app-password correct"},"took":0.074608087539672852}';
    const host = new Host({
      baseUrl: 'http://10.0.0.2',
      password: 'mypassword'
    });
    let config: ConfigInterface;
    const log = new Log(false);

    const createClient = async () => {
      nock(host.fullUrl).get('/api/auth').reply(200);
      nock(host.fullUrl).post('/api/auth').reply(200, goodResponse);

      return {
        teleporter: nock(host.fullUrl),
        client: await ClientV6.create({ host, log, options: config.sync.v6 })
      };
    };

    beforeEach(() => {
      nock.disableNetConnect();

      config = Config({
        primaryHost: { baseUrl: host.baseUrl, password: host.password },
        secondaryHosts: [{ baseUrl: host.baseUrl, password: host.password }]
      });
    });

    afterEach(() => {
      nock.cleanAll();
      nock.enableNetConnect();
    });

    describe('create', () => {
      test('should throw error if status code is not ok', async () => {
        const initialRequest = nock(host.fullUrl).get('/api/auth').reply(200);
        const loginRequest = nock(host.fullUrl).post('/api/auth').reply(500);

        const expectError = expect(
          ClientV6.create({ host, log, options: config.sync.v6 })
        ).rejects;

        await expectError.toBeInstanceOf(ErrorNotification);
        await expectError.toMatchObject({
          message:
            'There was an error logging in to "http://10.0.0.2" - are you able to log in with the configured password?',
          verbose: {
            host: 'http://10.0.0.2',
            path: '/api/auth',
            status: 500,
            responseBody: ''
          }
        });
        initialRequest.done();
        loginRequest.done();
      });

      test('should return client', async () => {
        const initialRequest = nock(host.fullUrl).get('/api/auth').reply(200);
        const loginRequest = nock(host.fullUrl)
          .post('/api/auth')
          .reply(200, goodResponse);

        await expect(
          ClientV6.create({ host, log, options: config.sync.v6 })
        ).resolves.toBeInstanceOf(ClientV6);

        initialRequest.done();
        loginRequest.done();
      });

      test('should return version 6 and Host info', async () => {
        const initialRequest = nock(host.baseUrl).get('/api/auth').reply(200);
        const loginRequest = nock(host.baseUrl)
          .post('/api/auth')
          .reply(200, goodResponse);

        const v6Client = await ClientV6.create({ host, log, options: config.sync.v6 });

        expect(v6Client.getVersion()).toEqual(6);
        expect(v6Client.getHost()).toBe(host);

        initialRequest.done();
        loginRequest.done();
      });
    });

    describe('downloadBackup', () => {
      let client: ClientV6;
      let teleporter: nock.Scope;

      beforeEach(async () => {
        ({ client, teleporter } = await createClient());
      });

      afterEach(() => {
        teleporter.done();
      });

      test('should throw error if response is non-200', async () => {
        teleporter.get('/api/teleporter').reply(500);

        const expectError = expect(client.downloadBackup()).rejects;

        await expectError.toBeInstanceOf(ErrorNotification);
        await expectError.toMatchObject({
          message: 'Failed to download backup from "http://10.0.0.2".',
          verbose: {
            host: 'http://10.0.0.2',
            path: '/api/teleporter',
            status: 500,
            responseBody: ''
          }
        });
      });

      test('should return response data', async () => {
        teleporter.get('/api/teleporter').reply(200, undefined, {
          'content-type': 'application/zip',
          'content-disposition': 'attachement; filename="backup.zip"'
        });

        const backup = await client.downloadBackup();

        expect(backup).toBeInstanceOf(Blob);
      });
    });

    describe('uploadBackup', () => {
      const backup = new Blob([]);
      let client: ClientV6;
      let teleporter: nock.Scope;

      beforeEach(async () => {
        ({ client, teleporter } = await createClient());
      });

      afterEach(() => {
        teleporter.done();
      });

      test('should return success if response is 200', async () => {
        teleporter.post('/api/teleporter').reply(200);

        const response = expect(client.uploadBackup(backup)).resolves;

        await response.toEqual(true);
      });

      test('should throw error if response is non-200', async () => {
        teleporter.post('/api/teleporter').reply(500);

        const expectError = expect(client.uploadBackup(backup)).rejects;

        await expectError.toBeInstanceOf(ErrorNotification);
        await expectError.toMatchObject({
          message: 'Failed to upload backup to "http://10.0.0.2".',
          verbose: {
            host: 'http://10.0.0.2',
            path: '/api/teleporter',
            status: 500,
            responseBody: ''
          }
        });
      });
    });

    describe('updateGravity', () => {
      let client: ClientV6;
      let teleporter: nock.Scope;

      beforeEach(async () => {
        ({ client, teleporter } = await createClient());
      });

      afterEach(() => {
        teleporter.done();
      });

      test('should upload backup and update gravity successfully', async () => {
        teleporter
          .post('/api/action/gravity', undefined)
          .reply(200, '[✓] TCP (IPv6)\n[✓] Pi-hole blocking is enabled\n[✓] Done');

        const result = await client.updateGravity();

        expect(result).toStrictEqual(true);
      });

      test('should throw error if gravity update fails', async () => {
        teleporter.post('/api/action/gravity', undefined).reply(401, '');

        const expectError = expect(client.updateGravity()).rejects;

        await expectError.toBeInstanceOf(ErrorNotification);
        await expectError.toMatchObject({
          message: 'Failed updating gravity on "http://10.0.0.2".',
          verbose: {
            host: 'http://10.0.0.2',
            path: '/api/action/gravity',
            status: 401,
            eventStream: ''
          }
        });
      });

      test('should retry if fetch error is thrown', async () => {
        jest.useFakeTimers({ advanceTimers: true });
        teleporter
          .post('/api/action/gravity', undefined)
          .replyWithError({ code: 'ETIMEDOUT' })
          .post('/api/action/gravity', undefined)
          .reply(200, '[✓] TCP (IPv6)\n[✓] Pi-hole blocking is enabled\n[✓] Done');

        const result = client.updateGravity();

        expect(await result).toStrictEqual(true);
      });

      test('should retry if 502-504 us returned', async () => {
        for (const status of [502, 503, 504]) {
          jest.useFakeTimers({ advanceTimers: true });
          teleporter
            .post('/api/action/gravity', undefined)
            .reply(status, 'Bad Gateway')
            .post('/api/action/gravity', undefined)
            .reply(200, '[✓] TCP (IPv6)\n[✓] Pi-hole blocking is enabled\n[✓] Done');

          const result = client.updateGravity();

          expect(await result).toStrictEqual(true);
        }
      });

      test('should throw if all retries fail', async () => {
        jest.useFakeTimers({ advanceTimers: true });
        config.sync.v6.gravityUpdateRetryCount = 2;
        teleporter
          .post('/api/action/gravity', undefined)
          .replyWithError({ code: 'ETIMEDOUT' })
          .post('/api/action/gravity', undefined)
          .replyWithError({ code: 'ETIMEDOUT' });

        const expectError = expect(client.updateGravity()).rejects;

        await expectError.toBeInstanceOf(ErrorNotification);
        await expectError.toMatchObject({
          message: 'Exhausted 3 retries updating gravity on http://10.0.0.2.',
          verbose: {
            host: 'http://10.0.0.2',
            path: '/api/action/gravity'
          }
        });
      });
    });
  });
});
