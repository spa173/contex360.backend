const nodemailer = require('nodemailer');

async function testEmail() {
  const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: {
      user: 'ab59a4001@smtp-brevo.com',
      pass: 'xsmtpsib-fd62d4b8b7598c9fc5f7eac898836581741ba315bbe71b7bd648d6b72c4b24ec-kKoXdQ1dzMLgdNVW',
    },
  });

  try {
    console.log('Enviando correo de prueba...');
    const info = await transporter.sendMail({
      from: 'ab59a4001@smtp-brevo.com',
      to: 'brayan174cmm@gmail.com',
      subject: 'Prueba Técnica Contex360',
      text: 'Hola Brayan, esta es una prueba directa desde el servidor para verificar el envío de correos.',
      html: '<b>Hola Brayan</b>, esta es una prueba directa desde el servidor para verificar el envío de correos.',
    });
    console.log('Correo enviado con éxito:', info.messageId);
  } catch (error) {
    console.error('Error enviando correo:', error);
  }
}

testEmail();
