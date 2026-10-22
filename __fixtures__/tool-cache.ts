import type * as tc from '@actions/tool-cache'
import { jest } from '@jest/globals'

export const downloadTool = jest.fn<typeof tc.downloadTool>()
export const extractZip = jest.fn<typeof tc.extractZip>()
