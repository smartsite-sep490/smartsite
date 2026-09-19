export type NormalizedCoordinate = readonly [number, number];

export interface CameraObservationRegionConfiguration {
  readonly regionId: string;
  readonly geometryVersion: number;
  readonly coordinateSpace: 'NORMALIZED_0_1';
  readonly polygon: { readonly coordinates: readonly NormalizedCoordinate[] };
}

export interface CameraRegionConfiguration {
  readonly schemaVersion: '1.0.0';
  readonly configurationVersion: number;
  readonly cameraExternalId: string;
  readonly regions: readonly CameraObservationRegionConfiguration[];
}
