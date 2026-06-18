const fs = require('fs')

/**
 * SplitOutput
 *
 * Object-oriented refactor of the original procedural splitOutput.js script.
 * Encapsulates configuration, processing logic, validation functions,
 * counters, and reporting functionality that were previously implemented
 * as loose top-level statements.
 *
 * The constructor accepts configuration values and stores application
 * state (file paths, flags, counters, header map) so that each method
 * can operate on shared state without relying on global variables.
 */
class SplitOutput {
  constructor(config) {
    // ── Configuration flags ──────────────────────────
    this.ignoreTitleCheck = config.ignoreTitleCheck
    this.checkPostCode = config.checkPostCode
    this.pipe = config.pipe

    // ── File paths ───────────────────────────────────
    this.sDataLocation = config.sDataLocation
    this.sJobsLocation = config.sJobsLocation
    this.sPathResources = this.sJobsLocation + 'Resources\\'
    this.sPath2Input = this.sDataLocation + 'Input\\'
    this.sPath2Output = this.sDataLocation + 'InpSplit\\'
    this.sPath2Report = this.sDataLocation + 'Reports\\'

    this.jobName = config.jobName
    this.outFilename = this.sPath2Output + 'Valid-' + this.jobName
    this.lpFilename = this.sPath2Output + 'LP-' + this.jobName
    this.invalidFilename = this.sPath2Output + 'Invalid-' + this.jobName
    this.reportFilename = this.sPath2Report + this.jobName + '.report'

    // ── Application state ────────────────────────────
    this.headerColumns = []
    this.headerIndexedMap = {}
    this.headerLine = ''

    // ── Counters ──────────────────────────────────────
    this.valid = 0
    this.inValid = 0
    this.largePrint = 0
  }

  /**
   * Loads and parses the HeaderMap.txt configuration file, building the
   * indexed column map used to look up field positions on each row.
   */
  loadHeaderMap(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const headers = {}
      content.split('\n').forEach((line) => {
        const [key, value] = line.split('=').map((s) => s.trim())
        if (key && value) headers[key] = value
      })

      if (!headers.HEADERINP) {
        throw new Error('HeaderMap.txt is missing the HEADERINP entry')
      }

      this.headerColumns = headers.HEADERINP.split(',')
      this.headerColumns.forEach((col, i) => {
        this.headerIndexedMap[col] = i
      })
      this.headerLine = this.headerColumns.join(',')

      return headers
    } catch (err) {
      throw new Error(`Failed to load header map: ${err.message}`)
    }
  }

  /**
   * Deletes any existing output files from a previous run and writes
   * the header line to each output file ready for processing.
   */
  prepareOutputFiles() {
    try {
      const files = [this.outFilename, this.lpFilename, this.invalidFilename]

      files.forEach((f) => {
        if (fs.existsSync(f)) fs.unlinkSync(f)
      })

      files.forEach((f) =>
        fs.writeFileSync(f, this.headerLine + '\n', 'utf-8'),
      )
    } catch (err) {
      throw new Error(`Failed to prepare output files: ${err.message}`)
    }
  }

  /**
   * Validates a date string against the dd/MM/yyyy format
   * (matches the original Groovy SimpleDateFormat behaviour).
   */
  parseDate_ddMMyyyy(str) {
    const match = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    if (!match) return null

    const [, dd, mm, yyyy] = match
    const d = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd))

    return d.getFullYear() == yyyy &&
      d.getMonth() == mm - 1 &&
      d.getDate() == parseInt(dd)
      ? d
      : null
  }

  /**
   * Validates the mandatory fields on a row. Respects the
   * ignoreTitleCheck and checkPostCode configuration flags, matching
   * the original business rules exactly.
   */
  checkRequiredFields(row) {
    const H = this.headerIndexedMap
    const spAge = row[H['SP_AGE']] || ''
    const sTitle = row[H['TITLE']] || ''
    const sInitial = row[H['INITIAL']] || ''
    const sFirstName = row[H['FIRST_NAME']] || ''
    const sSurname = row[H['SURNAME']] || ''
    const pCode = row[H['POSTCODE']] || ''

    let tempValid = true

    if (this.ignoreTitleCheck) {
      if (
        !spAge.trim() ||
        !sInitial.trim() ||
        !sFirstName.trim() ||
        !sSurname.trim()
      )
        tempValid = false
    } else {
      if (
        !spAge.trim() ||
        !sTitle.trim() ||
        !sInitial.trim() ||
        !sFirstName.trim() ||
        !sSurname.trim()
      )
        tempValid = false
    }

    if (this.checkPostCode && tempValid && !pCode.trim()) tempValid = false

    return tempValid
  }

  /**
   * Processes a single data row: validates required fields, validates
   * the date, and routes the row to the correct output file
   * (Valid, LargePrint, or Invalid), updating the relevant counter.
   */
  processRow(row) {
    const H = this.headerIndexedMap
    const spAge = row[H['SP_AGE']] || ''

    if (!this.checkRequiredFields(row)) {
      fs.appendFileSync(this.invalidFilename, row.join(this.pipe) + '\n')
      this.inValid++
      return
    }

    const parsedDate = this.parseDate_ddMMyyyy(spAge.trim())
    if (!parsedDate) {
      fs.appendFileSync(this.invalidFilename, row.join(this.pipe) + '\n')
      this.inValid++
      return
    }

    const altFormat = (row[H['ALT_FORMAT']] || '').trim().toUpperCase()
    if (altFormat === 'LARGE PRINT') {
      fs.appendFileSync(this.lpFilename, row.join(this.pipe) + '\n')
      this.largePrint++
    } else {
      fs.appendFileSync(this.outFilename, row.join(this.pipe) + '\n')
      this.valid++
    }
  }

  /**
   * Reads the input file, validates the header row against the
   * expected header line, then processes each data row in turn.
   */
  processInputFile() {
    try {
      const lines = fs
        .readFileSync(this.sPath2Input + this.jobName, 'utf-8')
        .split('\n')
        .filter((l) => l.trim() !== '')

      lines.forEach((line, idx) => {
        const lineNum = idx + 1

        if (lineNum === 1) {
          const cleanLine = line
            .replace(/\t/g, '')
            .replace(/"/g, '')
            .replace(/,,/g, '')

          if (cleanLine !== this.headerLine) {
            throw new Error('!!Data Header record does not match expected!!')
          }
          return
        }

        const row = line.split(this.pipe)
        this.processRow(row)
      })
    } catch (err) {
      throw new Error(`Failed to process input file: ${err.message}`)
    }
  }

  /**
   * Writes the summary report file detailing total, valid, large print,
   * and invalid record counts for this run.
   */
  writeReport() {
    try {
      const reportContent = [
        `Filename,${this.jobName}`,
        `Total Records,${this.valid + this.largePrint + this.inValid}`,
        `Valid,${this.valid}`,
        `LargePrint,${this.largePrint}`,
        `Invalid,${this.inValid}`,
      ].join('\n')

      fs.writeFileSync(this.reportFilename, reportContent, 'utf-8')
    } catch (err) {
      throw new Error(`Failed to write report: ${err.message}`)
    }
  }

  /**
   * Returns a summary of the processing counters for this run.
   */
  getSummary() {
    return {
      valid: this.valid,
      largePrint: this.largePrint,
      inValid: this.inValid,
      total: this.valid + this.largePrint + this.inValid,
    }
  }

  /**
   * Orchestrates the full process: load header map, prepare output
   * files, process the input file, write the report, and log the
   * summary to the console.
   */
  run() {
    try {
      this.loadHeaderMap(this.sPathResources + 'HeaderMap.txt')
      this.prepareOutputFiles()
      this.processInputFile()
      this.writeReport()

      const summary = this.getSummary()
      console.log(
        `Done — Valid: ${summary.valid}, LP: ${summary.largePrint}, Invalid: ${summary.inValid}`,
      )

      return summary
    } catch (err) {
      console.error(`SplitOutput run failed: ${err.message}`)
      throw err
    }
  }
}

module.exports = SplitOutput

// ── Execution entry point ──────────────────────────
// Mirrors the configuration values from the original procedural script.
if (require.main === module) {
  const splitOutput = new SplitOutput({
    ignoreTitleCheck: true,
    checkPostCode: false,
    pipe: ',',
    sDataLocation: '\\\\srv604gmc\\DP\\DP_Data\\DM\\DWP\\83511_64595\\',
    sJobsLocation: '\\\\srv604gmc\\DP\\DP_Jobs\\DM\\DWP\\64595_83511\\Scripts\\',
    jobName: 'From_DWP_MBA_Mailings_AOBG1679_SPA67_UK_1965_5.csv',
  })

  splitOutput.run()
}
