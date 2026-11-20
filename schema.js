// Table definitions. They match the desktop app's Turso schema column for column, so both apps share one database.
// Types: t=text, r=real, i=integer, b=yes/no (0/1), d=date/time (ISO text)
const T = (s) => s.split(',').map((x) => { const [n, t] = x.split(':'); return { name: n, type: t || 't' }; });

const tables = {
  Sectors: { versioned: true, cols: T('Id,Name,Description,BaseFee:r,IsActive:b,CreatedDate:d,RequiredDocumentTypes,IsTourPackageType:b,IsAirTicketType:b') },
  Applicants: { versioned: true, cols: T('Id,FullName,Phone,Email,Address,PassportNumber,DestinationCountry,SectorId,Status,CreatedDate:d,InterviewDate:d,AssignedStaff,Notes,PassportExpiryDate:d,ReferralAgentId,TravelStartDate:d,TravelEndDate:d,NumberOfTravelers:i,ItineraryNotes,FlightAirline,FlightPnr,FlightDepartureDate:d,FlightRoute,TicketNumber,WhatsApp,University,Course,Intake,AdmissionDeadline:d') },
  Invoices: { versioned: true, cols: T('Id,InvoiceNumber,ApplicantId,Date:d,DiscountPercent:r,TaxPercent:r,AmountPaid:r,Status,Notes,DateOfSupply:d,CustomerTin,DueDate:d,WalkInName,WalkInPhone,WalkInEmail') },
  InvoiceItems: { versioned: true, cols: T('Id,InvoiceId,Description,Quantity:i,UnitPrice:r,ForName') },
  Payments: { versioned: true, cols: T('Id,InvoiceId,Date:d,Amount:r,Method,Notes,ServiceDescription') },
  Users: { versioned: true, extra: ', UNIQUE(Username)', cols: T('Id,Username,PasswordHash,FullName,Role,IsActive:b,CreatedDate:d,LastLogin:d,ExtraRoles') },
  Agents: { versioned: true, cols: T('Id,Name,Phone,Email,CommissionPercent:r,Notes,IsActive:b,CreatedDate:d,ApplyWht:b,WhtRatePercent:r') },
  AuditLog: { versioned: false, cols: T('Id,Timestamp:d,UserName,Action,EntityType,Description') },
  StatusHistory: { versioned: false, cols: T('Id,ApplicantId,FromStatus,ToStatus,Timestamp:d') },
  CompanySettings: { versioned: true, cols: T('Id,LegalName,RegisteredAddress,Tin,VatRegistrationNumber,BusinessRegistrationNumber,BranchCode,IsVatRegistered:b,DefaultWhtRatePercent:r,WhtMonthlyThresholdLkr:r') },
  Employees: { versioned: true, cols: T('Id,EmployeeNumber,FullName,Nic,Designation,JoinDate:d,EpfNumber,BankDetails,BasicSalary:r,EpfAllowance:r,OtherAllowance:r,EpfApplicable:b,IsActive:b,Notes,CreatedDate:d,EtfNumber,Location,BankName,BankAccountNumber,BankBranch,Email') },
  CaseActivities: { versioned: true, cols: T('Id,ApplicantId,Type,Notes,ActivityDate:d,StaffName,FollowUpDate:d,FollowUpCompleted:b,CreatedDate:d') },
  SalaryRecords: { versioned: true, cols: T('Id,EmployeeId,Year:i,Month:i,BasicSalary:r,EpfAllowances:r,OtherAllowances:r,Overtime:r,Bonus:r,EpfEmployee:r,EpfEmployer:r,EtfEmployer:r,Advance:r,OtherDeductions:r,Apit:r,IsPaid:b,PaidDate:d,Notes,CreatedDate:d,EpfApplicable:b,Commission:r,AnnualLeaveDays:i') },
  LedgerEntries: { versioned: true, cols: T('Id,Date:d,Kind,Category,Description,Party,Amount:r,Method,ApplicantId,InvoiceId,Status,CreatedBy,CreatedDate:d,Source') },
  ServiceCatalog: { versioned: true, cols: T('Id,Category,Name,Price:r,IsActive:b') },
  Installments: { versioned: true, cols: T('Id,InvoiceId,Label,Amount:r,DueDate:d,PaymentId') },
  SharedSettings: { versioned: true, cols: T('Id,Value') },
  // Scanned documents: the file lives in Cloudflare R2 (StoredPath = "r2:<key>"); only the record is in the database.
  // Fallback file storage inside the database (used when Cloudflare R2 is not set up).
  DocFiles: { versioned: false, cols: T('Id,Data') },
  Documents: { versioned: true, cols: T('Id,ApplicantId,FileName,StoredPath,DocType,UploadDate:d,ExpiryDate:d') },
  InstitutionalDocuments: { versioned: true, cols: T('Id,Title,Category,CounterpartyName,CounterpartyCountry,ReferenceNumber,SignedDate:d,ExpiryDate:d,FileName,StoredPath,Notes,CreatedDate:d') },
};

const SQL_TYPE = { t: 'TEXT', r: 'REAL', i: 'INTEGER', b: 'INTEGER', d: 'TEXT' };

// Who may read / write each table through the generic API. Roles: Admin, Manager, Accountant, Payroll, Staff.
const ANY = ['Admin', 'Manager', 'Accountant', 'Payroll', 'Staff'];
const access = {
  Sectors: { read: ANY, write: ANY, adminOnlyWrite: false },
  Applicants: { read: ANY, write: ANY },
  Agents: { read: ANY, write: ANY },
  CaseActivities: { read: ANY, write: ANY },
  ServiceCatalog: { read: ANY, write: ANY },
  Installments: { read: ANY, write: ANY },
  Documents: { read: ANY, write: ANY },
  InstitutionalDocuments: { read: ANY, write: ANY },
  Employees: { read: ['Admin', 'Manager', 'Payroll'], write: ['Admin', 'Manager', 'Payroll'] },
  SalaryRecords: { read: ['Admin', 'Manager', 'Payroll'], write: ['Admin', 'Manager', 'Payroll'] },
  LedgerEntries: { read: ['Admin', 'Manager', 'Accountant'], write: ['Admin', 'Manager', 'Accountant'] },
  Users: { read: ['Admin'], write: ['Admin'] },
  AuditLog: { read: ['Admin', 'Manager'], write: [] },
};

const STATUSES = ['Inquiry', 'DocumentCollection', 'Submitted', 'VfsInterviewScheduled', 'Approved', 'Rejected', 'Completed'];
const ROLES = ['Admin', 'Manager', 'Accountant', 'Payroll', 'Staff'];

module.exports = { tables, SQL_TYPE, access, STATUSES, ROLES };
