import express from 'express';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();
app.use(express.json());

interface ContactResponse {
  primaryContactId: number;
  emails: string[];
  phoneNumbers: string[];
  secondaryContactIds: number[];
}

app.post('/identify', async (req, res) => {
  try {
    const { email, phoneNumber } = req.body;

    if (!email && !phoneNumber) {
      return res.status(400).json({ error: 'At least email or phoneNumber must be provided.' });
    }

     const matchingContacts = await prisma.contact.findMany({
      where: {
        OR: [
          { email: email || undefined },
          { phoneNumber: phoneNumber || undefined },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    if (matchingContacts.length === 0) {
      const newContact = await prisma.contact.create({
        data: {
          email: email || null,
          phoneNumber: phoneNumber || null,
          linkPrecedence: 'primary',  
        },
      });

      console.log("no match");
      return 
        res.json({contact: {
          primaryContactId: newContact.id,
          emails: [newContact.email].filter(Boolean),
          phoneNumbers: [newContact.phoneNumber].filter(Boolean),
          secondaryContactIds: [],
        },
      });
    }


    let allRelatedContacts = [...matchingContacts];
    // console.log(allRelatedContacts)

    const visited = new Set<number>();
    const toVisit = matchingContacts
      .map(c => c.linkedId || c.id)
      .filter(id => !!id);

    while (toVisit.length) {
      const currentId = toVisit.pop()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const related = await prisma.contact.findMany({
        where: {
          OR: [
            { id: currentId },
            { linkedId: currentId },
          ],
        },
      });

      for (const contact of related) {
        if (!allRelatedContacts.some(c => c.id === contact.id)) {
          allRelatedContacts.push(contact);
          if (contact.linkedId) toVisit.push(contact.linkedId);
        }
      }
    }


    const primaryContact = allRelatedContacts
      .filter(c => c.linkPrecedence === 'primary')
      .sort((a, b) => +a.createdAt - +b.createdAt)[0];


    const contactsToUpdate = allRelatedContacts.filter(
      c => c.linkPrecedence === 'primary' && c.id !== primaryContact.id
    );

    for (const contact of contactsToUpdate) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: {
          linkPrecedence: 'secondary',
          linkedId: primaryContact.id,
        },
      });
    }

    const isExactMatch = allRelatedContacts.some(
  c => c.email === email && c.phoneNumber === phoneNumber
);

    console.log(isExactMatch);
    if (!isExactMatch && email && phoneNumber) {
      await prisma.contact.create({
        data: {
          email: email || null,
          phoneNumber: phoneNumber || null,
          linkPrecedence: 'secondary',
          linkedId: primaryContact.id,
        },
      });
    }

    const finalContacts = await prisma.contact.findMany({
      where: {
        OR: [
          { id: primaryContact.id },
          { linkedId: primaryContact.id },
        ],
      },
    });

    const emails = Array.from(
      new Set(finalContacts.map(c => c.email).filter(Boolean) as string[])
    );

    const phoneNumbers = Array.from(
      new Set(finalContacts.map(c => c.phoneNumber).filter(Boolean) as string[])
    );

    const secondaryContactIds = finalContacts
      .filter(c => c.linkPrecedence === 'secondary')
      .map(c => c.id);

    const response: ContactResponse = {
      primaryContactId: primaryContact.id,
      emails,
      phoneNumbers,
      secondaryContactIds,
    };

    return res.json({ contact: response });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
