package services

import "pdd-order-system/config"

// sqlAvgHoursDiff returns a SQL expression that computes the average hours
// between two timestamp columns. Handles SQLite vs PostgreSQL syntax.
//   - SQLite:    AVG((julianday(end) - julianday(start)) * 24)
//   - PostgreSQL: AVG(EXTRACT(EPOCH FROM (end - start)) / 3600)
func sqlAvgHoursDiff(endCol, startCol string) string {
	if config.C.DBType == "postgres" {
		return "AVG(EXTRACT(EPOCH FROM (" + endCol + " - " + startCol + ")) / 3600)"
	}
	return "AVG((julianday(" + endCol + ") - julianday(" + startCol + ")) * 24)"
}

// sqlFormatDate returns a SQL expression that formats a timestamp column
// as 'YYYY-MM-DD'.
//   - SQLite:    strftime('%Y-%m-%d', col)
//   - PostgreSQL: TO_CHAR(col, 'YYYY-MM-DD')
func sqlFormatDate(col string) string {
	if config.C.DBType == "postgres" {
		return "TO_CHAR(" + col + ", 'YYYY-MM-DD')"
	}
	return "strftime('%Y-%m-%d', " + col + ")"
}

// sqlFormatMonth returns a SQL expression that extracts a zero-padded
// month number ('01'-'12') from a timestamp column.
//   - SQLite:    strftime('%m', col)
//   - PostgreSQL: TO_CHAR(col, 'MM')
func sqlFormatMonth(col string) string {
	if config.C.DBType == "postgres" {
		return "TO_CHAR(" + col + ", 'MM')"
	}
	return "strftime('%m', " + col + ")"
}
