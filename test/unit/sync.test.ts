import { describe, expect, jest, test } from '@jest/globals';
import nock from 'nock';
import { Blob } from 'node-fetch';
import { ClientFactory, Client } from '../../src/client';
import { Config, Version } from '../../src/config/index';
import { Log } from '../../src/log';
import { ErrorNotification, Notify } from '../../src/notify';
import { Sync } from '../../src/sync';
import { SyncOptionsV6 } from '../../src/config/index';

describe('sync', () => {
  let clientCreate: ReturnType<typeof jest.spyOn>;
  let notifyOfFailure: ReturnType<typeof jest.spyOn>;
  let notifyQueueError: ReturnType<typeof jest.spyOn>;
  let notifyOfSuccess: ReturnType<typeof jest.spyOn>;
  let processExit: ReturnType<typeof jest.spyOn>;
  let primaryHostClient: Client;
  let secondaryHostClient1: Client;
  let secondaryHostClient2: Client;

  const primaryHostValue = {
    baseUrl: 'http://10.0.0.2',
    password: 'password1',
    path: ''
  };
  const secondaryHostsValue = [
    { baseUrl: 'http://10.0.0.3', password: 'password2', path: '' },
    { baseUrl: 'http://10.0.0.4', password: 'password3', path: '' }
  ];
  const backupData = new Blob([]);

  beforeEach(() => {
    nock.disableNetConnect();
    jest.restoreAllMocks();
    // Had to disable useFakeTimers for promise-sleep to work in sync.ts !?!?!?!?!
    // jest.useFakeTimers();
  });

  afterEach(() => {
    jest.resetModules();
  });

  afterAll(() => {
    // jest.useRealTimers();
    nock.cleanAll();
    nock.enableNetConnect();
  });

  const prepare = ({
    primaryResult,
    secondaryOneResult,
    secondaryTwoResult
  }: {
    primaryResult?: Promise<Blob>;
    secondaryOneResult?: Promise<boolean | never>;
    secondaryTwoResult?: Promise<boolean | never>;
  } = {}) => {
    const config = Config({
      piHoleVersion: '6',
      primaryHost: primaryHostValue,
      secondaryHosts: secondaryHostsValue,
      runOnce: true
    });
    const notify = new Notify(config);
    const log = new Log(config.verbose);

    processExit = jest.spyOn(process, 'exit').mockReturnValue(undefined as never);
    primaryHostClient = {
      downloadBackup: jest.fn(() => primaryResult ?? Promise.resolve(backupData))
    } as unknown as Client;
    secondaryHostClient1 = {
      uploadBackup: jest.fn(() => secondaryOneResult ?? Promise.resolve(true)),
      updateGravity: jest.fn(() => Promise.resolve(true))
    } as unknown as Client;
    secondaryHostClient2 = {
      uploadBackup: jest.fn(() => secondaryTwoResult ?? Promise.resolve(true)),
      updateGravity: jest.fn(() => Promise.resolve(true))
    } as unknown as Client;
    clientCreate = jest
      .spyOn(ClientFactory, 'createClient')
      .mockResolvedValueOnce(primaryHostClient)
      .mockResolvedValueOnce(secondaryHostClient1)
      .mockResolvedValueOnce(secondaryHostClient2);
    notifyOfFailure = jest.spyOn(notify, 'ofFailure');
    notifyQueueError = jest.spyOn(notify, 'queueError');
    notifyOfSuccess = jest.spyOn(notify, 'ofSuccess');

    return { config, notify, log };
  };

  const expectSyncToHaveBeenPerformed = ({
    version,
    options,
    log
  }: {
    version: Version;
    options: SyncOptionsV6;
    log: Log;
  }) => {
    expect(clientCreate).toHaveBeenCalledTimes(3);
    expect(clientCreate).toHaveBeenNthCalledWith(1, {
      host: expect.objectContaining(primaryHostValue),
      version,
      options,
      log
    });
    expect(clientCreate).toHaveBeenNthCalledWith(2, {
      host: expect.objectContaining(secondaryHostsValue[0]),
      version,
      options,
      log
    });
    expect(clientCreate).toHaveBeenNthCalledWith(3, {
      host: expect.objectContaining(secondaryHostsValue[1]),
      version,
      options,
      log
    });
    expect(primaryHostClient.downloadBackup).toHaveBeenCalledTimes(1);
    expect(secondaryHostClient1.uploadBackup).toHaveBeenCalledTimes(1);
    expect(secondaryHostClient1.uploadBackup).toHaveBeenCalledWith(backupData);
    expect(secondaryHostClient2.uploadBackup).toHaveBeenCalledTimes(1);
    expect(secondaryHostClient2.uploadBackup).toHaveBeenCalledWith(backupData);
  };

  test('should perform sync and succeed', async () => {
    const { config, notify, log } = prepare();

    await Sync.perform(config, { notify, log });

    expectSyncToHaveBeenPerformed({ version: '6', options: config.sync.v6, log });
    expect(notifyOfFailure).not.toHaveBeenCalled();
    expect(notifyQueueError).not.toHaveBeenCalled();
    expect(notifyOfSuccess).toHaveBeenCalledTimes(1);
    expect(notifyOfSuccess).toHaveBeenCalledWith({
      message: '2/2 hosts synced.'
    });
    expect(processExit).not.toHaveBeenCalled();
  });

  test('should perform sync and partially succeed', async () => {
    const { config, notify, log } = prepare({
      secondaryTwoResult: Promise.reject(new ErrorNotification({ message: 'foobar' }))
    });

    await Sync.perform(config, { notify, log });

    expectSyncToHaveBeenPerformed({ version: '6', options: config.sync.v6, log });
    expect(notifyOfSuccess).not.toHaveBeenCalled();
    expect(notifyQueueError).toHaveBeenCalledTimes(1);
    expect(notifyQueueError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'foobar'
      })
    );
    expect(notifyOfFailure).toHaveBeenCalledTimes(1);
    expect(notifyOfFailure).toHaveBeenCalledWith({
      sendNotification: true,
      message: '1/2 hosts synced.'
    });
    expect(processExit).toHaveBeenCalledTimes(1);
  });

  test('should perform sync and fail', async () => {
    const { config, notify, log } = prepare({
      secondaryOneResult: Promise.reject(new ErrorNotification({ message: 'foobar' })),
      secondaryTwoResult: Promise.reject(
        new ErrorNotification({ message: 'hello world' })
      )
    });

    await Sync.perform(config, { notify, log });

    expectSyncToHaveBeenPerformed({ version: '6', options: config.sync.v6, log });
    expect(notifyOfSuccess).not.toHaveBeenCalled();
    expect(notifyQueueError).toHaveBeenCalledTimes(2);
    expect(notifyQueueError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'foobar'
      })
    );
    expect(notifyQueueError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'hello world'
      })
    );
    expect(notifyOfFailure).toHaveBeenCalledTimes(1);
    expect(notifyOfFailure).toHaveBeenCalledWith({
      message: '0/2 hosts synced.'
    });
    expect(processExit).toHaveBeenCalledTimes(1);
  });

  test('should perform sync and fail', async () => {
    const { config, notify, log } = prepare({
      primaryResult: Promise.reject(
        new ErrorNotification({ message: 'Backup failed to download' })
      )
    });

    await Sync.perform(config, { notify, log });

    expect(notifyOfSuccess).not.toHaveBeenCalled();
    expect(notifyQueueError).not.toHaveBeenCalled();
    expect(notifyOfFailure).toHaveBeenCalledTimes(1);
    expect(notifyOfFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Backup failed to download'
      })
    );
    expect(secondaryHostClient1.uploadBackup).not.toHaveBeenCalled();
    expect(secondaryHostClient2.uploadBackup).not.toHaveBeenCalled();
    expect(processExit).toHaveBeenCalledTimes(1);
  });
});
