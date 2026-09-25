import { TestBed } from '@angular/core/testing';
import { NuxeoHttpService } from './nuxeo-http.service';
import { FetchStub, installFetchStub } from '../../testing/fetch-stub';

/** A Nuxeo 500 relaying an OpenSearch error, as the passthrough writes one. */
function relayed(openSearchError: unknown): unknown {
  return {
    'entity-type': 'exception',
    status: 500,
    message:
      'org.nuxeo.runtime.RuntimeServiceException: org.opensearch.client.ResponseException: ' +
      'method [GET], host [http://opensearch:9200], URI [/nuxeo/_search?' +
      'cancel_after_time_interval=90s], status line [HTTP/1.1 500 Internal Server Error]\n' +
      JSON.stringify({ error: openSearchError, status: 500 }),
  };
}

/*
 * A search OpenSearch cancelled reaches the browser as a Nuxeo 500 like any other failure, and
 * "500 on /nuxeo/site/es/nuxeo/_search" reads as a broken server. It is a search asked to do too
 * much, which the reader can do something about.
 */
describe('NuxeoHttpService, when OpenSearch cancels a search', () => {
  let stub: FetchStub;

  afterEach(() => stub?.restore());

  function search() {
    return TestBed.inject(NuxeoHttpService).search('nuxeo', { size: 0 });
  }

  it('says the search was stopped on time, and after how long', async () => {
    stub = installFetchStub([
      {
        match: '/site/es/nuxeo/_search',
        status: 500,
        json: relayed({
          root_cause: [
            {
              type: 'task_cancelled_exception',
              reason: 'cancelled task with reason: Cancellation timeout of 1.5m is expired',
            },
          ],
          type: 'search_phase_execution_exception',
          reason: 'all shards failed',
        }),
      },
    ]);

    await expect(search()).rejects.toThrow(
      'OpenSearch stopped the search on the nuxeo index after 90s, before it had answered.',
    );
  });

  it('says it was cancelled when only a shard that had not started says so', async () => {
    stub = installFetchStub([
      {
        match: '/site/es/nuxeo/_search',
        status: 500,
        json: relayed({
          root_cause: [
            {
              type: 'task_cancelled_exception',
              reason: "The parent task was cancelled, shouldn't start any child tasks",
            },
          ],
        }),
      },
    ]);

    await expect(search()).rejects.toThrow(
      'OpenSearch cancelled the search on the nuxeo index before it had answered.',
    );
  });

  it('leaves any other failure as it was', async () => {
    stub = installFetchStub([
      {
        match: '/site/es/nuxeo/_search',
        status: 500,
        json: relayed({ root_cause: [{ type: 'too_many_buckets_exception' }] }),
      },
    ]);

    await expect(search()).rejects.toThrow('500 on /nuxeo/site/es/nuxeo/_search');
  });
});
