import { Injectable, Logger } from '@nestjs/common'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'

export interface ExportColumn {
	key: string
	header: string
	width?: number
	format?: 'currency' | 'date' | 'number' | 'text'
}

export interface ExportOptions {
	title: string
	subtitle?: string
	columns: ExportColumn[]
	data: Record<string, unknown>[]
	filename: string
}

@Injectable()
export class ExportService {
	private readonly logger = new Logger(ExportService.name)

	async generateExcel(options: ExportOptions): Promise<Buffer> {
		const workbook = new ExcelJS.Workbook()
		workbook.creator = 'Vendinhas'
		workbook.created = new Date()

		const worksheet = workbook.addWorksheet(options.title)

		// Add title row
		worksheet.mergeCells('A1', `${String.fromCharCode(64 + options.columns.length)}1`)
		const titleCell = worksheet.getCell('A1')
		titleCell.value = options.title
		titleCell.font = { size: 16, bold: true }
		titleCell.alignment = { horizontal: 'center' }

		// Add subtitle if present
		let startRow = 3
		if (options.subtitle) {
			worksheet.mergeCells('A2', `${String.fromCharCode(64 + options.columns.length)}2`)
			const subtitleCell = worksheet.getCell('A2')
			subtitleCell.value = options.subtitle
			subtitleCell.font = { size: 12, italic: true }
			subtitleCell.alignment = { horizontal: 'center' }
			startRow = 4
		}

		// Add headers
		const headerRow = worksheet.getRow(startRow)
		options.columns.forEach((col, idx) => {
			const cell = headerRow.getCell(idx + 1)
			cell.value = col.header
			cell.font = { bold: true }
			cell.fill = {
				type: 'pattern',
				pattern: 'solid',
				fgColor: { argb: 'FF6366F1' },
			}
			cell.font = { color: { argb: 'FFFFFFFF' }, bold: true }
			cell.alignment = { horizontal: 'center' }

			worksheet.getColumn(idx + 1).width = col.width || 15
		})

		// Add data rows
		options.data.forEach((row, rowIdx) => {
			const dataRow = worksheet.getRow(startRow + 1 + rowIdx)
			options.columns.forEach((col, colIdx) => {
				const cell = dataRow.getCell(colIdx + 1)
				const value = row[col.key]

				if (col.format === 'currency' && typeof value === 'number') {
					cell.value = value / 100
					cell.numFmt = 'R$ #,##0.00'
				} else if (col.format === 'date' && value instanceof Date) {
					cell.value = value
					cell.numFmt = 'dd/mm/yyyy'
				} else if (col.format === 'number' && typeof value === 'number') {
					cell.value = value
					cell.numFmt = '#,##0'
				} else {
					cell.value = value as string | number
				}
			})
		})

		// Add borders
		const lastRow = startRow + options.data.length
		for (let row = startRow; row <= lastRow; row++) {
			for (let col = 1; col <= options.columns.length; col++) {
				const cell = worksheet.getCell(row, col)
				cell.border = {
					top: { style: 'thin' },
					left: { style: 'thin' },
					bottom: { style: 'thin' },
					right: { style: 'thin' },
				}
			}
		}

		const buffer = await workbook.xlsx.writeBuffer()
		this.logger.log(`📊 Excel generated: ${options.filename}`)

		return Buffer.from(buffer)
	}

	async generatePDF(options: ExportOptions): Promise<Buffer> {
		return new Promise((resolve, reject) => {
			try {
				const doc = new PDFDocument({ margin: 50, size: 'A4' })
				const chunks: Buffer[] = []

				doc.on('data', (chunk) => chunks.push(chunk))
				doc.on('end', () => {
					const buffer = Buffer.concat(chunks)
					this.logger.log(`📄 PDF generated: ${options.filename}`)
					resolve(buffer)
				})
				doc.on('error', reject)

				// Header
				doc.fontSize(20).font('Helvetica-Bold').text(options.title, { align: 'center' })
				doc.moveDown(0.5)

				if (options.subtitle) {
					doc.fontSize(12).font('Helvetica-Oblique').text(options.subtitle, { align: 'center' })
					doc.moveDown(0.5)
				}

				doc.fontSize(10).font('Helvetica').text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, { align: 'right' })
				doc.moveDown(1)

				// Table
				const tableTop = doc.y
				const pageWidth = doc.page.width - 100
				const colWidth = pageWidth / options.columns.length

				// Headers
				doc.font('Helvetica-Bold').fontSize(10)
				let x = 50
				options.columns.forEach((col) => {
					doc.text(col.header, x, tableTop, { width: colWidth, align: 'left' })
					x += colWidth
				})

				doc.moveTo(50, tableTop + 15).lineTo(50 + pageWidth, tableTop + 15).stroke()

				// Data
				doc.font('Helvetica').fontSize(9)
				let y = tableTop + 25

				options.data.forEach((row) => {
					if (y > doc.page.height - 100) {
						doc.addPage()
						y = 50
					}

					x = 50
					options.columns.forEach((col) => {
						let value = row[col.key]

						if (col.format === 'currency' && typeof value === 'number') {
							value = `R$ ${(value / 100).toFixed(2).replace('.', ',')}`
						} else if (col.format === 'date' && value instanceof Date) {
							value = value.toLocaleDateString('pt-BR')
						} else if (value === null || value === undefined) {
							value = '-'
						}

						doc.text(String(value), x, y, { width: colWidth - 5, align: 'left' })
						x += colWidth
					})

					y += 20
				})

				// Footer
				const pages = doc.bufferedPageRange()
				for (let i = 0; i < pages.count; i++) {
					doc.switchToPage(i)
					doc.fontSize(8).text(
						`Página ${i + 1} de ${pages.count} - Vendinhas`,
						50,
						doc.page.height - 30,
						{ align: 'center', width: pageWidth },
					)
				}

				doc.end()
			} catch (error) {
				reject(error)
			}
		})
	}

	formatCurrency(value: number): string {
		return `R$ ${(value / 100).toFixed(2).replace('.', ',')}`
	}

	formatDate(date: Date): string {
		return date.toLocaleDateString('pt-BR')
	}
}
