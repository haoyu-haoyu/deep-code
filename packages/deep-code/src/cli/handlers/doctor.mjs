import {
  formatDoctorChecksText,
  normalizeDoctorReport,
  runDoctorChecks,
} from './doctorChecks.mjs'

export async function doctorHandler({
  checksRunner = runDoctorChecks,
  json = false,
  stdout = process.stdout,
} = {}) {
  const report = normalizeDoctorReport(await checksRunner())

  if (json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    stdout.write(formatDoctorChecksText(report))
  }

  return report
}
