/**
 * Ciclos reservados exclusivamente para a suíte de integração do workflow.
 *
 * Eles respeitam o contrato canônico YYMM e vivem apenas no banco medicoes_e2e.
 * A lista centralizada também permite que o seed remova com segurança resíduos de
 * uma execução interrompida, sem depender de prefixos artificiais no campo ciclo.
 */
export const WORKFLOW_TEST_CYCLES = {
  happy: "9901",
  divergencia: "9902",
  revisao: "9903",
  ownership: "9904",
  ciclo1: "9905",
  ciclo2: "9906",
  "idemp-enviar": "9907",
  "idemp-aprovar": "9908",
  "idemp-pagar": "9909",
} as const;

export type WorkflowFixtureLabel = Exclude<keyof typeof WORKFLOW_TEST_CYCLES, "ciclo2">;

export const WORKFLOW_TEST_CYCLE_VALUES = Object.values(WORKFLOW_TEST_CYCLES);
