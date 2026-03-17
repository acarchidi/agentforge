import { z } from 'zod';
import { relatedServicesField } from './shared.js';

export const contractDocsInput = z.object({
  address: z.string().min(1),
  chain: z
    .enum(['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche'])
    .default('ethereum'),
  focusFunctions: z.array(z.string()).optional(),
});

export type ContractDocsInput = z.infer<typeof contractDocsInput>;

const riskFlagEnum = z.enum([
  'owner_only',
  'can_transfer_funds',
  'can_modify_state',
  'can_pause',
  'can_upgrade',
  'can_mint',
  'can_burn',
  'can_blacklist',
  'self_destruct',
  'delegatecall',
  'unchecked_external_call',
]);

export const contractDocsOutput = z.object({
  contract: z.object({
    address: z.string(),
    chain: z.string(),
    name: z.string().nullable(),
    compilerVersion: z.string().nullable(),
    isVerified: z.boolean(),
    isProxy: z.boolean(),
    implementationAddress: z.string().nullable(),
    registryLabel: z.string().optional(),
    registryProtocol: z.string().optional(),
    registryCategory: z.string().optional(),
  }),

  functions: z.array(
    z.object({
      name: z.string(),
      signature: z.string(),
      type: z.enum(['read', 'write', 'payable']),
      description: z.string(),
      parameters: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          description: z.string(),
        }),
      ),
      returns: z.array(
        z.object({
          type: z.string(),
          description: z.string(),
        }),
      ),
      riskFlags: z.array(riskFlagEnum),
    }),
  ),

  events: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      parameters: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          indexed: z.boolean(),
        }),
      ),
    }),
  ),

  interactionPatterns: z
    .array(
      z.object({
        pattern: z.string(),
        description: z.string(),
        functions: z.array(z.string()),
        gasEstimate: z.string().nullable(),
      }),
    )
    .optional(),

  securityPosture: z
    .object({
      hasOwnerControls: z.boolean(),
      isPausable: z.boolean(),
      isUpgradeable: z.boolean(),
      hasMintCapability: z.boolean(),
      hasBlacklistCapability: z.boolean(),
      usesExternalCalls: z.boolean(),
      adminFunctionCount: z.number(),
      assessment: z.string(),
    })
    .optional(),

  proxyInfo: z
    .object({
      isProxy: z.boolean(),
      proxyType: z.string().optional(),
      proxyAddress: z.string(),
      implementationAddress: z.string(),
      governanceFramework: z.string().optional(),
      note: z.string(),
    })
    .optional(),

  summary: z.object({
    totalFunctions: z.number(),
    readFunctions: z.number(),
    writeFunctions: z.number(),
    adminFunctions: z.number(),
    riskLevel: z.enum(['low', 'medium', 'high']),
    overview: z.string(),
  }),

  metadata: z.object({
    model: z.string(),
    processingTimeMs: z.number(),
    estimatedCostUsd: z.number(),
    abiSize: z.number(),
  }),
  relatedServices: relatedServicesField,
});

export type ContractDocsOutput = z.infer<typeof contractDocsOutput>;
