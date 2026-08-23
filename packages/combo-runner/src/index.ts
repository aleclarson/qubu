export {
  ADAPTER_IDS,
  ADAPTER_VARIANTS,
  COMBO_STATUS_BY_ADAPTER,
  COMBO_STATUSES,
  DATABASE_ENGINES,
  ENVIRONMENT_IDS,
  ENVIRONMENTS,
  comboKey,
  comboRegistry,
  defineRegistry,
  findCombo,
  registry,
  type RegistryValidationOptions,
  statusCounts,
  type AdapterId,
  type AdapterVariant,
  type ComboCell,
  type ComboKey,
  type ComboRegistry,
  type ComboStatus,
  type DatabaseEngine,
  type EnvironmentDefinition,
  type EnvironmentId,
} from "./catalog.js";
export {
  isVerificationModule,
  type ProvisionedDatabase,
  type VerificationContext,
  type VerificationModule,
  type VerifyFunction,
} from "./contract.js";
export {
  createDisposableProvisioner,
  createUnavailableProvisioner,
  type DatabaseProvisioner,
  type ProvisionedResource,
  type ProvisionerFactory,
  type ProvisionRequest,
} from "./provisioners.js";
export * from "./launchers/index.js";
export {
  runCombo,
  runVerifiedCombos,
  selectCiMatrix,
  selectVerifiedCombos,
  type CiMatrixEntry,
  type ComboSelector,
  type RunnerDependencies,
  type RunOptions,
  type VerificationRun,
} from "./runner.js";
export { renderCatalog } from "./catalog-markdown.js";
