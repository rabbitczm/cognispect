"""Verification and password recovery messages sent through configured SMTP."""
from email.message import EmailMessage
import smtplib
import ssl


class SMTPMailer:
    def __init__(self, config):
        self.config = config

    @property
    def configured(self):
        return bool(self.config.get('HOST') and self.config.get('FROM'))

    def __call__(self, message):
        if not self.configured:
            raise ValueError('邮件服务尚未配置')
        config = self.config
        email = EmailMessage()
        email['From'] = config['FROM']
        email['To'] = message['to']
        email['Subject'] = message['subject']
        email.set_content(message['text'])
        mode = config.get('TLS') or 'starttls'
        transport = smtplib.SMTP_SSL if mode == 'ssl' else smtplib.SMTP
        kwargs = {'timeout': 30}
        if mode == 'ssl':
            kwargs['context'] = ssl.create_default_context()
        with transport(config['HOST'], int(config.get('PORT') or (465 if mode == 'ssl' else 587)), **kwargs) as smtp:
            if mode == 'starttls':
                smtp.starttls(context=ssl.create_default_context())
            if config.get('USER'):
                smtp.login(config['USER'], config.get('PASSWORD', ''))
            smtp.send_message(email)

