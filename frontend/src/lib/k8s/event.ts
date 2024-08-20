import { useMemo } from 'react';
import { ResourceClasses } from '.';
import { ApiError, apiFactoryWithNamespace, QueryParameters } from './apiProxy';
import { request } from './apiProxy';
import { KubeMetadata, KubeObject, makeKubeObject } from './cluster';

export interface KubeEvent {
  type: string;
  reason: string;
  message: string;
  metadata: KubeMetadata;
  involvedObject: {
    kind: string;
    namespace: string;
    name: string;
    uid: string;
    apiVersion: string;
    resourceVersion: string;
    fieldPath: string;
  };
  [otherProps: string]: any;
}

class Event extends makeKubeObject<KubeEvent>('Event') {
  static apiEndpoint = apiFactoryWithNamespace('', 'v1', 'events');

  // Max number of events to fetch from the API
  private static maxEventsLimit = 2000;

  // Getter to get the max number of events that are to be fetched
  static get maxLimit() {
    return this.maxEventsLimit;
  }

  // Setter to set the max number of events that are to be fetched
  static set maxLimit(limit: number) {
    this.maxEventsLimit = limit;
  }

  get spec() {
    return this.getValue('spec');
  }

  get status() {
    return this.getValue('status');
  }

  get involvedObject() {
    return this.getValue('involvedObject');
  }

  get type() {
    return this.getValue('type');
  }

  get reason() {
    return this.getValue('reason');
  }

  get message() {
    return this.getValue('message');
  }

  get source() {
    return this.getValue('source');
  }

  get count() {
    const series = this.getValue('series');
    if (!!series) {
      return series.count;
    }

    return this.getValue('count');
  }

  get lastOccurrence() {
    const series = this.getValue('series');
    if (!!series) {
      return series.lastObservedTime;
    }

    const lastTimestamp = this.getValue('lastTimestamp');
    if (!!lastTimestamp) {
      return lastTimestamp;
    }

    const eventTime = this.getValue('eventTime');
    if (!!eventTime) {
      return eventTime;
    }

    const firstTimestamp = this.getValue('firstTimestamp');
    if (!!firstTimestamp) {
      return firstTimestamp;
    }

    const creationTimestamp = this.metadata.creationTimestamp;
    return creationTimestamp;
  }

  get firstOccurrence() {
    const eventTime = this.getValue('eventTime');
    if (!!eventTime) {
      return eventTime;
    }

    const firstTimestamp = this.firstTimestamp;
    if (!!firstTimestamp) {
      return firstTimestamp;
    }

    const creationTimestamp = this.metadata.creationTimestamp;
    return creationTimestamp;
  }

  static async objectEvents(object: KubeObject) {
    const namespace = object.metadata.namespace;
    const name = object.metadata.name;
    const objectKind = object.kind;

    let path = '/api/v1/events';
    const fieldSelector: { [key: string]: string } = {
      'involvedObject.kind': objectKind,
      'involvedObject.name': name,
    };

    if (namespace) {
      path = `/api/v1/namespaces/${namespace}/events`;
      fieldSelector['involvedObject.namespace'] = namespace;
    }

    const queryParams = {
      fieldSelector: Object.keys(fieldSelector)
        .map(function (k) {
          return `${k}=${fieldSelector[k]}`;
        })
        .join(','),
      limit: this.maxLimit,
    };

    const response = await request(path, {}, true, true, queryParams);

    return response.items;
  }

  get involvedObjectInstance(): KubeObject | null {
    if (!this.involvedObject) {
      return null;
    }

    const InvolvedObjectClass = ResourceClasses[this.involvedObject.kind];
    let objInstance: KubeObject | null = null;
    if (!!InvolvedObjectClass) {
      objInstance = new InvolvedObjectClass({
        kind: this.involvedObject.kind,
        metadata: {
          name: this.involvedObject.name,
          namespace: this.involvedObject.namespace,
        },
      });
    }

    return objInstance;
  }

  /**
   * Fetch events for given clusters
   *
   * Important! Make sure to have the parent component have clusters as a key
   * so that component remounts when clusters change, instead of rerendering
   * with different number of clusters
   */
  static useListForClusters(
    clusterNames: string[],
    options: { queryParams?: QueryParameters } = {}
  ) {
    // Calling hooks in a loop is usually forbidden
    // But if we make sure that clusters don't change between renders it's fine
    const queries = clusterNames.map(cluster => {
      return Event.useList({ cluster, ...options.queryParams });
    });

    type EventsPerCluster = {
      [cluster: string]: {
        warnings: Event[];
        error?: ApiError | null;
      };
    };

    const result = useMemo(() => {
      const res: EventsPerCluster = {};

      queries.forEach((query, index) => {
        const cluster = clusterNames[index];
        res[cluster] = {
          warnings: query.data?.items ?? [],
          error: query.error as ApiError,
        };
      });

      return res;
    }, [queries, clusterNames]);

    return result;
  }

  /**
   * Fetch warning events for given clusters
   * Amount is limited to {@link Event.maxEventsLimit}
   *
   * Important! Make sure to have the parent component have clusters as a key
   * so that component remounts when clusters change, instead of rerendering
   * with different number of clusters
   */
  static useWarningList(clusters: string[], options?: { queryParams?: QueryParameters }) {
    const queryParameters = Object.assign(
      {
        limit: this.maxEventsLimit,
        fieldSelector: 'type!=Normal',
      },
      options?.queryParams ?? {}
    );

    return this.useListForClusters(clusters, { queryParams: queryParameters });
  }
}

export default Event;
