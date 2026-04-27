import { z } from 'zod';
    import { zendeskClient } from '../zendesk-client.js';

    export const ticketsTools = [
      {
        name: "list_tickets",
        description: "List tickets in Zendesk",
        schema: {
          page: z.number().optional().describe("Page number for pagination"),
          per_page: z.number().optional().describe("Number of tickets per page (max 100)"),
          sort_by: z.string().optional().describe("Field to sort by"),
          sort_order: z.enum(["asc", "desc"]).optional().describe("Sort order (asc or desc)")
        },
        handler: async ({ page, per_page, sort_by, sort_order }) => {
          try {
            const params = { page, per_page, sort_by, sort_order };
            const result = await zendeskClient.listTickets(params);
            return {
              content: [{ 
                type: "text", 
                text: JSON.stringify(result, null, 2)
              }]
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error listing tickets: ${error.message}` }],
              isError: true
            };
          }
        }
      },
      {
        name: "get_ticket",
        description: "Get a specific ticket by ID",
        schema: {
          id: z.number().describe("Ticket ID")
        },
        handler: async ({ id }) => {
          try {
            const result = await zendeskClient.getTicket(id);
            return {
              content: [{ 
                type: "text", 
                text: JSON.stringify(result, null, 2)
              }]
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error getting ticket: ${error.message}` }],
              isError: true
            };
          }
        }
      },
      {
        name: "create_ticket",
        description: "Create a new ticket",
        schema: {
          subject: z.string().describe("Ticket subject"),
          comment: z.string().describe("Ticket comment/description"),
          priority: z.enum(["urgent", "high", "normal", "low"]).optional().describe("Ticket priority"),
          status: z.enum(["new", "open", "pending", "hold", "solved", "closed"]).optional().describe("Ticket status"),
          requester_id: z.number().optional().describe("User ID of the requester"),
          assignee_id: z.number().optional().describe("User ID of the assignee"),
          group_id: z.number().optional().describe("Group ID for the ticket"),
          type: z.enum(["problem", "incident", "question", "task"]).optional().describe("Ticket type"),
          tags: z.array(z.string()).optional().describe("Tags for the ticket")
        },
        handler: async ({ subject, comment, priority, status, requester_id, assignee_id, group_id, type, tags }) => {
          try {
            const ticketData = {
              subject,
              comment: { body: comment },
              priority,
              status,
              requester_id,
              assignee_id,
              group_id,
              type,
              tags
            };
            
            const result = await zendeskClient.createTicket(ticketData);
            return {
              content: [{ 
                type: "text", 
                text: `Ticket created successfully!\n\n${JSON.stringify(result, null, 2)}`
              }]
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error creating ticket: ${error.message}` }],
              isError: true
            };
          }
        }
      },
      {
        name: "update_ticket",
        description: "Update an existing ticket",
        schema: {
          id: z.number().describe("Ticket ID to update"),
          subject: z.string().optional().describe("Updated ticket subject"),
          comment: z.string().optional().describe("New comment to add"),
          priority: z.enum(["urgent", "high", "normal", "low"]).optional().describe("Updated ticket priority"),
          status: z.enum(["new", "open", "pending", "hold", "solved", "closed"]).optional().describe("Updated ticket status"),
          assignee_id: z.number().optional().describe("User ID of the new assignee"),
          group_id: z.number().optional().describe("New group ID for the ticket"),
          type: z.enum(["problem", "incident", "question", "task"]).optional().describe("Updated ticket type"),
          tags: z.array(z.string()).optional().describe("Updated tags for the ticket")
        },
        handler: async ({ id, subject, comment, priority, status, assignee_id, group_id, type, tags }) => {
          try {
            const ticketData = {};
            
            if (subject !== undefined) ticketData.subject = subject;
            if (comment !== undefined) ticketData.comment = { body: comment };
            if (priority !== undefined) ticketData.priority = priority;
            if (status !== undefined) ticketData.status = status;
            if (assignee_id !== undefined) ticketData.assignee_id = assignee_id;
            if (group_id !== undefined) ticketData.group_id = group_id;
            if (type !== undefined) ticketData.type = type;
            if (tags !== undefined) ticketData.tags = tags;
            
            const result = await zendeskClient.updateTicket(id, ticketData);
            return {
              content: [{ 
                type: "text", 
                text: `Ticket updated successfully!\n\n${JSON.stringify(result, null, 2)}`
              }]
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error updating ticket: ${error.message}` }],
              isError: true
            };
          }
        }
      },
      {
        name: "delete_ticket",
        description: "Delete a ticket",
        schema: {
          id: z.number().describe("Ticket ID to delete")
        },
        handler: async ({ id }) => {
          try {
            await zendeskClient.deleteTicket(id);
            return {
              content: [{
                type: "text",
                text: `Ticket ${id} deleted successfully!`
              }]
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error deleting ticket: ${error.message}` }],
              isError: true
            };
          }
        }
      },
      {
        name: "get_ticket_with_thread",
        description: "Get a ticket with its full comment thread and all attachments rendered in formats Claude can use directly (images as image content, PDFs/Word/Excel/CSV/text extracted to text). Use this instead of get_ticket when scoping or investigating a ticket — get_ticket alone returns description + metadata only and does not include the comment thread.",
        schema: {
          id: z.number().describe("Ticket ID"),
          include_attachments: z.boolean().optional().default(true).describe("If false, attachment metadata is included but binaries are not fetched. Default true."),
          max_attachment_mb: z.number().optional().default(20).describe("Skip any single attachment larger than this many megabytes; surface its URL only. Default 20.")
        },
        handler: async ({ id, include_attachments = true, max_attachment_mb = 20 }) => {
          // Helper: render one attachment into one or more MCP content blocks.
          // Returns an array of content blocks (text and/or image).
          const MAX_TEXT_CHARS = 200_000; // 200 KB cap on extracted text per attachment
          const sizeLimitBytes = max_attachment_mb * 1024 * 1024;

          const renderAttachment = async (att) => {
            const meta = `[${att.file_name || 'attachment'} | ${att.content_type || 'unknown type'} | ${att.size != null ? att.size + ' bytes' : 'size unknown'}]`;

            if (!include_attachments) {
              return [{ type: 'text', text: `Attachment ${meta}\n  URL: ${att.content_url}\n  (binary not fetched: include_attachments=false)` }];
            }
            if (att.size != null && att.size > sizeLimitBytes) {
              return [{ type: 'text', text: `Attachment ${meta}\n  URL: ${att.content_url}\n  (skipped: exceeds max_attachment_mb=${max_attachment_mb})` }];
            }

            let buf;
            try {
              buf = await zendeskClient.downloadAttachment(att.content_url);
            } catch (e) {
              return [{ type: 'text', text: `Attachment ${meta}\n  URL: ${att.content_url}\n  (download failed: ${e.message})` }];
            }

            const ct = (att.content_type || '').toLowerCase();

            // Images → MCP image block
            if (ct.startsWith('image/')) {
              return [
                { type: 'text', text: `Attachment ${meta}` },
                { type: 'image', data: buf.toString('base64'), mimeType: att.content_type }
              ];
            }

            // PDFs → text via pdf-parse
            if (ct === 'application/pdf') {
              try {
                const { default: pdfParse } = await import('pdf-parse');
                const out = await pdfParse(buf);
                let text = out.text || '';
                let truncated = false;
                if (text.length > MAX_TEXT_CHARS) {
                  text = text.slice(0, MAX_TEXT_CHARS);
                  truncated = true;
                }
                return [{ type: 'text', text: `Attachment ${meta} (PDF, ${out.numpages || '?'} pages, text-extracted${truncated ? ', TRUNCATED at ' + MAX_TEXT_CHARS + ' chars' : ''}):\n${text}` }];
              } catch (e) {
                return [{ type: 'text', text: `Attachment ${meta}\n  URL: ${att.content_url}\n  (PDF text extraction failed: ${e.message})` }];
              }
            }

            // Excel (.xlsx) → render each sheet as CSV-like text
            if (ct === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || ct === 'application/vnd.ms-excel') {
              try {
                const XLSX = (await import('xlsx')).default || (await import('xlsx'));
                const wb = XLSX.read(buf, { type: 'buffer' });
                const parts = [];
                let totalChars = 0;
                for (const sheetName of wb.SheetNames) {
                  const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
                  const remaining = MAX_TEXT_CHARS - totalChars;
                  if (remaining <= 0) {
                    parts.push(`--- Sheet: ${sheetName} (omitted: total truncation cap reached) ---`);
                    break;
                  }
                  const piece = csv.length > remaining ? csv.slice(0, remaining) + '\n…(truncated)' : csv;
                  parts.push(`--- Sheet: ${sheetName} ---\n${piece}`);
                  totalChars += piece.length;
                }
                return [{ type: 'text', text: `Attachment ${meta} (Excel, ${wb.SheetNames.length} sheet(s)):\n${parts.join('\n\n')}` }];
              } catch (e) {
                return [{ type: 'text', text: `Attachment ${meta}\n  URL: ${att.content_url}\n  (Excel parse failed: ${e.message})` }];
              }
            }

            // Word (.docx) → text via mammoth
            if (ct === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
              try {
                const mammoth = (await import('mammoth')).default || (await import('mammoth'));
                const out = await mammoth.extractRawText({ buffer: buf });
                let text = out.value || '';
                let truncated = false;
                if (text.length > MAX_TEXT_CHARS) {
                  text = text.slice(0, MAX_TEXT_CHARS);
                  truncated = true;
                }
                return [{ type: 'text', text: `Attachment ${meta} (Word, text-extracted${truncated ? ', TRUNCATED at ' + MAX_TEXT_CHARS + ' chars' : ''}):\n${text}` }];
              } catch (e) {
                return [{ type: 'text', text: `Attachment ${meta}\n  URL: ${att.content_url}\n  (Word text extraction failed: ${e.message})` }];
              }
            }

            // Plain text / CSV / JSON / logs → return content directly
            if (ct.startsWith('text/') || ct === 'application/json' || ct === 'application/csv' || ct === 'application/x-ndjson') {
              let text = buf.toString('utf8');
              let truncated = false;
              if (text.length > MAX_TEXT_CHARS) {
                text = text.slice(0, MAX_TEXT_CHARS);
                truncated = true;
              }
              return [{ type: 'text', text: `Attachment ${meta}${truncated ? ' (TRUNCATED at ' + MAX_TEXT_CHARS + ' chars)' : ''}:\n${text}` }];
            }

            // Anything else → URL + metadata only
            return [{ type: 'text', text: `Attachment ${meta}\n  URL: ${att.content_url}\n  (binary type — open manually)` }];
          };

          try {
            const ticketResp = await zendeskClient.getTicket(id);
            const commentsResp = await zendeskClient.getTicketComments(id);
            const ticket = ticketResp.ticket || ticketResp;
            const comments = commentsResp.comments || [];

            const blocks = [];
            blocks.push({
              type: 'text',
              text: `# Ticket #${ticket.id} — ${ticket.subject || '(no subject)'}\nStatus: ${ticket.status} | Priority: ${ticket.priority} | Type: ${ticket.type || 'n/a'}\nCreated: ${ticket.created_at} | Updated: ${ticket.updated_at}\nRequester ID: ${ticket.requester_id} | Assignee ID: ${ticket.assignee_id} | Org ID: ${ticket.organization_id}\nTags: ${(ticket.tags || []).join(', ')}\n\n## Description\n${ticket.description || '(empty)'}\n\n## Comment thread (${comments.length} comments)`
            });

            for (let i = 0; i < comments.length; i++) {
              const c = comments[i];
              const visibility = c.public === false ? 'INTERNAL NOTE' : 'public';
              blocks.push({
                type: 'text',
                text: `\n--- Comment ${i + 1}/${comments.length} (${visibility}) by author_id=${c.author_id} on ${c.created_at} ---\n${c.body || ''}`
              });
              const atts = c.attachments || [];
              for (const att of atts) {
                const rendered = await renderAttachment(att);
                for (const block of rendered) blocks.push(block);
              }
            }

            return { content: blocks };
          } catch (error) {
            return {
              content: [{ type: 'text', text: `Error getting ticket with thread: ${error.message}` }],
              isError: true
            };
          }
        }
      }
    ];
