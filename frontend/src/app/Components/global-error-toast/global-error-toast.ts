import { Component, inject } from '@angular/core';
import { ErrorNotificationService } from '../../error-notification.service';

@Component({
  standalone: true,
  selector: 'app-global-error-toast',
  templateUrl: './global-error-toast.html',
  styleUrl: './global-error-toast.scss',
})
export class GlobalErrorToast {
  notification = inject(ErrorNotificationService);
}
